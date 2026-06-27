import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { automationRules, rustEntities, switchGroupMembers } from "@rusttools/db";
import type { RustPlusManager, NotificationService } from "@rusttools/rustplus-client";
import type {
  AutomationAction,
  AutomationCondition,
  AutomationRuleRecord,
  AutomationTrigger,
  TeamProximityCheck,
} from "@rusttools/shared";
import {
  defaultProximityCheckForCondition,
  evaluateTeamProximityCheck,
  isLocalTimeInScheduleWindow,
  parseStorageEntityInfo,
} from "@rusttools/shared";
import { resolveAutomationPoint } from "./automation-base.js";
import { getServerNotificationSettings } from "./server-notification-settings.js";
import { parseTeamRoster, getWorldSize } from "./rust-data.js";
import { applyTeamTrackingWithSettings } from "./team-tracker.js";
import type { AutomationBaseSettings, TeamRosterMember } from "@rusttools/shared";
import { resolveDefaultGuildChannelId } from "./discord-channels.js";
import { getSwitchState } from "./vending.js";
import { sendTeamChatIfUnmuted } from "./team-chat-outbound.js";

function parseRule(row: typeof automationRules.$inferSelect): AutomationRuleRecord {
  return {
    id: row.id,
    serverId: row.serverId,
    name: row.name,
    enabled: row.enabled,
    trigger: JSON.parse(row.triggerJson) as AutomationTrigger,
    conditions: JSON.parse(row.conditionsJson) as AutomationCondition[],
    actions: JSON.parse(row.actionsJson) as AutomationAction[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface ConditionContext {
  isDay: boolean;
  anyOnline: boolean;
  allOffline: boolean;
  teamMembers: TeamRosterMember[];
  worldSize: number;
  serverBase: AutomationBaseSettings;
}

async function loadConditionContext(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
): Promise<ConditionContext | null> {
  try {
    const [time, team, info, settings] = await Promise.all([
      rustPlus.getTime(),
      rustPlus.getTeamInfo(),
      rustPlus.getServerInfo(),
      getServerNotificationSettings(db, serverId),
    ]);
    const worldSize = getWorldSize(info) ?? 4000;
    const parsed = parseTeamRoster(team, worldSize);
    const tracked = await applyTeamTrackingWithSettings(db, serverId, parsed, worldSize);
    const members = tracked.team.members;
    return {
      isDay: (time as { isDay?: boolean }).isDay !== false,
      anyOnline: members.some((m) => m.isOnline),
      allOffline: members.every((m) => !m.isOnline),
      teamMembers: members,
      worldSize,
      serverBase: settings.automationBase,
    };
  } catch {
    return null;
  }
}

async function evaluateProximityCondition(
  db: Database,
  serverId: string,
  condition: AutomationCondition,
  ctx: ConditionContext,
  type: "team_near_point" | "team_away_from_point",
): Promise<boolean> {
  const point = await resolveAutomationPoint(db, serverId, ctx.serverBase, condition);
  if (!point) return false;
  const filter = condition.memberFilter ?? "active";
  const check: TeamProximityCheck =
    condition.proximityCheck ?? defaultProximityCheckForCondition(type);
  return evaluateTeamProximityCheck(
    ctx.teamMembers,
    filter,
    check,
    point.x,
    point.y,
    ctx.worldSize,
    point.radiusMeters,
  );
}

async function conditionsMet(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
  conditions: AutomationCondition[],
  ctx?: ConditionContext,
  switchStateCache?: Map<number, boolean | null>,
): Promise<boolean> {
  if (conditions.length === 0) return true;

  const context = ctx ?? (await loadConditionContext(db, rustPlus, serverId));
  if (!context) return false;

  const { isDay, anyOnline, allOffline } = context;

  for (const condition of conditions) {
    switch (condition.type) {
      case "switch_is": {
        if (!condition.entityId) return false;
        const [entity] = await db
          .select()
          .from(rustEntities)
          .where(eq(rustEntities.id, condition.entityId))
          .limit(1);
        if (!entity) return false;
        let state = switchStateCache?.get(entity.entityId);
        if (state === undefined) {
          state = await getSwitchState(rustPlus, entity.entityId);
          switchStateCache?.set(entity.entityId, state);
        }
        if (state !== condition.switchValue) return false;
        break;
      }
      case "team_any_online":
        if (!anyOnline) return false;
        break;
      case "team_all_offline":
        if (!allOffline) return false;
        break;
      case "time_is_day":
        if (!isDay) return false;
        break;
      case "time_is_night":
        if (isDay) return false;
        break;
      case "team_near_point":
        if (!(await evaluateProximityCondition(db, serverId, condition, context, "team_near_point"))) {
          return false;
        }
        break;
      case "team_away_from_point":
        if (!(await evaluateProximityCondition(db, serverId, condition, context, "team_away_from_point"))) {
          return false;
        }
        break;
      case "upkeep_below_hours": {
        if (!condition.entityId || condition.upkeepHours == null) return false;
        const [entity] = await db
          .select()
          .from(rustEntities)
          .where(eq(rustEntities.id, condition.entityId))
          .limit(1);
        if (!entity) return false;
        try {
          const info = await rustPlus.getEntityInfo(entity.entityId);
          const parsed = parseStorageEntityInfo(info);
          if (!parsed.upkeep) return false;
          if (parsed.upkeep.secondsRemaining / 3600 > condition.upkeepHours) return false;
        } catch {
          return false;
        }
        break;
      }
    }
  }

  return true;
}

async function runActions(
  db: Database,
  rustPlus: RustPlusManager,
  notifications: NotificationService,
  serverId: string,
  actions: AutomationAction[],
): Promise<void> {
  for (const action of actions) {
    switch (action.type) {
      case "set_switch":
      case "toggle_switch": {
        if (!action.entityId) break;
        const [entity] = await db
          .select()
          .from(rustEntities)
          .where(eq(rustEntities.id, action.entityId))
          .limit(1);
        if (!entity || entity.entityType !== "smart_switch") break;
        let value = action.switchValue ?? true;
        if (action.type === "toggle_switch") {
          const current = await getSwitchState(rustPlus, entity.entityId);
          value = current === null ? true : !current;
        }
        await rustPlus.toggleSwitch(entity.entityId, value);
        break;
      }
      case "toggle_switch_group": {
        if (!action.groupId) break;
        const members = await db
          .select({ entity: rustEntities })
          .from(switchGroupMembers)
          .innerJoin(rustEntities, eq(switchGroupMembers.entityId, rustEntities.id))
          .where(eq(switchGroupMembers.groupId, action.groupId));
        for (const { entity } of members) {
          try {
            const current = await getSwitchState(rustPlus, entity.entityId);
            const value = action.switchValue ?? (current === null ? true : !current);
            await rustPlus.toggleSwitch(entity.entityId, value);
          } catch {
            // continue
          }
        }
        break;
      }
      case "send_team_chat": {
        if (!action.message?.trim()) break;
        await sendTeamChatIfUnmuted(db, rustPlus, serverId, action.message.trim());
        break;
      }
      case "send_discord": {
        if (!action.message?.trim()) break;
        const channel = await resolveDefaultGuildChannelId(db, "events");
        if (!channel) break;
        await notifications.discord({
          channelId: channel,
          content: action.pingEveryone ? `@everyone ${action.message}` : action.message,
        });
        break;
      }
    }
  }
}

export async function listAutomationRules(
  db: Database,
  serverId: string,
): Promise<AutomationRuleRecord[]> {
  const rows = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.serverId, serverId));
  return rows.map(parseRule);
}

export async function dispatchAutomationEvent(
  db: Database,
  rustPlus: RustPlusManager,
  notifications: NotificationService,
  serverId: string,
  eventType: AutomationTrigger["type"],
  context: { entityId?: string; upkeepHours?: number },
): Promise<void> {
  const rules = await listAutomationRules(db, serverId);
  const matching = rules.filter((r) => r.enabled && r.trigger.type === eventType);
  const switchStateCache = new Map<number, boolean | null>();

  for (const rule of matching) {
    if (eventType === "smart_alarm" && rule.trigger.entityId && rule.trigger.entityId !== context.entityId) {
      continue;
    }
    if (eventType === "storage_changed" && rule.trigger.entityId && rule.trigger.entityId !== context.entityId) {
      continue;
    }
    if (eventType === "tc_upkeep_low") {
      const threshold = rule.trigger.upkeepHours ?? 24;
      if (context.upkeepHours != null && context.upkeepHours > threshold) continue;
    }

    if (!(await conditionsMet(db, rustPlus, serverId, rule.conditions, undefined, switchStateCache))) continue;
    await runActions(db, rustPlus, notifications, serverId, rule.actions);
  }
}

const lastIntervalRun = new Map<string, number>();
const lastTimeOfDayPhase = new Map<string, "day" | "night">();
const lastPresenceState = new Map<string, boolean>();
const lastScheduleWindowActive = new Map<string, boolean>();

export async function evaluateTeamPresenceAutomationRules(
  db: Database,
  rustPlus: RustPlusManager,
  notifications: NotificationService,
  serverId: string,
): Promise<void> {
  const ctx = await loadConditionContext(db, rustPlus, serverId);
  if (!ctx) return;

  const rules = await listAutomationRules(db, serverId).then((rows) =>
    rows.filter((r) => r.enabled && r.trigger.type === "team_presence_change"),
  );
  const switchStateCache = new Map<number, boolean | null>();

  for (const rule of rules) {
    const point = await resolveAutomationPoint(db, serverId, ctx.serverBase, rule.trigger);
    if (!point) continue;

    const filter = rule.trigger.memberFilter ?? "active";
    const check: TeamProximityCheck = rule.trigger.proximityCheck ?? "none_near";
    const presenceMet = evaluateTeamProximityCheck(
      ctx.teamMembers,
      filter,
      check,
      point.x,
      point.y,
      ctx.worldSize,
      point.radiusMeters,
    );

    const allMet =
      presenceMet && (await conditionsMet(db, rustPlus, serverId, rule.conditions, ctx, switchStateCache));
    const was = lastPresenceState.get(rule.id) ?? false;
    if (allMet && !was) {
      await runActions(db, rustPlus, notifications, serverId, rule.actions);
    }
    lastPresenceState.set(rule.id, allMet);
  }
}

export async function evaluateIntervalAutomationRules(
  db: Database,
  rustPlus: RustPlusManager,
  notifications: NotificationService,
  serverId: string,
): Promise<void> {
  const rules = await listAutomationRules(db, serverId).then((rows) =>
    rows.filter((r) => r.enabled && r.trigger.type === "interval"),
  );

  const now = Date.now();
  const switchStateCache = new Map<number, boolean | null>();
  for (const rule of rules) {
    const minutes = rule.trigger.intervalMinutes ?? 60;
    const key = rule.id;
    const last = lastIntervalRun.get(key) ?? 0;
    if (now - last < minutes * 60_000) continue;
    lastIntervalRun.set(key, now);

    if (!(await conditionsMet(db, rustPlus, serverId, rule.conditions, undefined, switchStateCache))) continue;
    await runActions(db, rustPlus, notifications, serverId, rule.actions);
  }
}

export async function evaluateTimeOfDayAutomationRules(
  db: Database,
  rustPlus: RustPlusManager,
  notifications: NotificationService,
  serverId: string,
  isDay: boolean,
): Promise<void> {
  const phase = isDay ? "day" : "night";
  const rules = await listAutomationRules(db, serverId).then((rows) =>
    rows.filter((r) => r.enabled && r.trigger.type === "time_of_day" && r.trigger.phase === phase),
  );

  const switchStateCache = new Map<number, boolean | null>();
  for (const rule of rules) {
    if (lastTimeOfDayPhase.get(rule.id) === phase) continue;
    lastTimeOfDayPhase.set(rule.id, phase);

    if (!(await conditionsMet(db, rustPlus, serverId, rule.conditions, undefined, switchStateCache))) continue;
    await runActions(db, rustPlus, notifications, serverId, rule.actions);
  }
}

export async function evaluateScheduleWindowAutomationRules(
  db: Database,
  rustPlus: RustPlusManager,
  notifications: NotificationService,
  serverId: string,
): Promise<void> {
  const rules = await listAutomationRules(db, serverId).then((rows) =>
    rows.filter((r) => r.enabled && r.trigger.type === "schedule_window"),
  );

  const switchStateCache = new Map<number, boolean | null>();
  for (const rule of rules) {
    const inWindow = isLocalTimeInScheduleWindow(rule.trigger);
    const was = lastScheduleWindowActive.get(rule.id) ?? false;
    const edge = rule.trigger.scheduleEdge ?? "enter";

    const shouldRun =
      (edge === "enter" || edge === "both") && inWindow && !was
        ? true
        : (edge === "exit" || edge === "both") && !inWindow && was;

    lastScheduleWindowActive.set(rule.id, inWindow);
    if (!shouldRun) continue;

    if (!(await conditionsMet(db, rustPlus, serverId, rule.conditions, undefined, switchStateCache))) continue;
    await runActions(db, rustPlus, notifications, serverId, rule.actions);
  }
}

export { parseRule };
