import { and, eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities, switchGroupMembers, switchGroups } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import {
  normalizeChatCommandAlias,
  parseSwitchChatCommand,
  type ParsedSwitchCommand,
} from "@rusttools/shared";
import { getEntitySettings } from "./entity-settings.js";
import { readSwitchStatusLabel, scheduleSwitchRevert } from "./switch-scheduler.js";
import { getSwitchState } from "./vending.js";

export interface SwitchCommandResult {
  reply: string;
}

async function findSwitchByAlias(db: Database, serverId: string, alias: string) {
  const switches = await db
    .select()
    .from(rustEntities)
    .where(and(eq(rustEntities.serverId, serverId), eq(rustEntities.entityType, "smart_switch")));

  for (const sw of switches) {
    const settings = await getEntitySettings(db, sw.id);
    const cmd = settings.switch?.chatCommand;
    if (cmd && normalizeChatCommandAlias(cmd) === alias) {
      return sw;
    }
  }
  return null;
}

async function findGroupByAlias(db: Database, serverId: string, alias: string) {
  const groups = await db
    .select()
    .from(switchGroups)
    .where(eq(switchGroups.serverId, serverId));

  for (const group of groups) {
    if (group.chatCommand && normalizeChatCommandAlias(group.chatCommand) === alias) {
      return group;
    }
  }
  return null;
}

async function applySwitchAction(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
  entityDbId: string,
  rustEntityId: number,
  parsed: ParsedSwitchCommand,
): Promise<SwitchCommandResult> {
  if (parsed.action === "status") {
    const label = await readSwitchStatusLabel(rustPlus, rustEntityId);
    return { reply: `RustTools: Switch is ${label}.` };
  }

  const current = await getSwitchState(rustPlus, rustEntityId);
  let target: boolean;
  if (parsed.action === "on") target = true;
  else if (parsed.action === "off") target = false;
  else target = current === null ? true : !current;

  await rustPlus.toggleSwitch(rustEntityId, target);

  if (parsed.timedSeconds && parsed.action !== "toggle") {
    const revertValue = parsed.action === "on" ? false : true;
    await scheduleSwitchRevert(db, rustPlus, {
      serverId,
      entityDbId,
      rustEntityId,
      revertValue,
      delaySeconds: parsed.timedSeconds,
    });
    return {
      reply: `RustTools: Switch ${target ? "ON" : "OFF"} for ${parsed.timedSeconds}s.`,
    };
  }

  return { reply: `RustTools: Switch ${target ? "ON" : "OFF"}.` };
}

async function applyGroupAction(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
  groupId: string,
  parsed: ParsedSwitchCommand,
): Promise<SwitchCommandResult> {
  const members = await db
    .select({ entity: rustEntities })
    .from(switchGroupMembers)
    .innerJoin(rustEntities, eq(switchGroupMembers.entityId, rustEntities.id))
    .where(eq(switchGroupMembers.groupId, groupId));

  if (members.length === 0) {
    return { reply: "RustTools: Switch group has no members." };
  }

  if (parsed.action === "status") {
    const states = await Promise.all(
      members.map(async (m) => {
        const label = await readSwitchStatusLabel(rustPlus, m.entity.entityId);
        return `${m.entity.displayName ?? m.entity.name}: ${label}`;
      }),
    );
    return { reply: `RustTools: ${states.join(", ")}` };
  }

  let toggled = 0;
  for (const { entity } of members) {
    try {
      const current = await getSwitchState(rustPlus, entity.entityId);
      let target: boolean;
      if (parsed.action === "on") target = true;
      else if (parsed.action === "off") target = false;
      else target = current === null ? true : !current;

      await rustPlus.toggleSwitch(entity.entityId, target);
      toggled += 1;

      if (parsed.timedSeconds && parsed.action !== "toggle") {
        const revertValue = parsed.action === "on" ? false : true;
        await scheduleSwitchRevert(db, rustPlus, {
          serverId,
          entityDbId: entity.id,
          rustEntityId: entity.entityId,
          revertValue,
          delaySeconds: parsed.timedSeconds,
        });
      }
    } catch {
      // continue
    }
  }

  const actionLabel =
    parsed.action === "toggle" ? "toggled" : parsed.action === "on" ? "turned on" : "turned off";
  return { reply: `RustTools: Group ${actionLabel} (${toggled} switches).` };
}

export async function executeSwitchChatCommand(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
  message: string,
): Promise<SwitchCommandResult | null> {
  const parsed = parseSwitchChatCommand(message);
  if (!parsed) return null;

  const group = await findGroupByAlias(db, serverId, parsed.alias);
  if (group) {
    return applyGroupAction(db, rustPlus, serverId, group.id, parsed);
  }

  const device = await findSwitchByAlias(db, serverId, parsed.alias);
  if (!device) return null;

  return applySwitchAction(db, rustPlus, serverId, device.id, device.entityId, parsed);
}
