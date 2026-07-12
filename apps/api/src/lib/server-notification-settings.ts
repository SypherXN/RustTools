import { and, eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustServers } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import {
  mergeNotificationSettings,
  parseServerNotificationSettings,
  seedServerNotificationSettingsFromEnv,
  type NotificationSettingsCapabilities,
  type NotificationSettingsResponse,
  type ServerNotificationSettings,
  type TeamChatBotSettings,
} from "@rusttools/shared";
import { getActiveFcmCredential } from "./fcm-credentials.js";
import { trimTeamTrackerDeaths } from "./team-tracker.js";
import { pruneTeamEventLogsToLimits } from "./team-event-store.js";
import { resolveDefaultGuildChannelId } from "./discord-channels.js";
import { hasCustomAlarmSound } from "./alarm-sound.js";

export async function notificationCapabilities(
  db: Database,
  rustPlus: RustPlusManager,
): Promise<NotificationSettingsCapabilities> {
  const status = rustPlus.getStatus();
  const alarmChannel = await resolveDefaultGuildChannelId(db, "alarms");
  const activeFcm = await getActiveFcmCredential(db);
  let customAlarmSoundConfigured = false;
  if (activeFcm) {
    const [server] = await db
      .select({ id: rustServers.id })
      .from(rustServers)
      .where(
        and(eq(rustServers.isActive, true), eq(rustServers.fcmCredentialId, activeFcm.id)),
      )
      .limit(1);
    if (server) {
      customAlarmSoundConfigured = hasCustomAlarmSound(server.id);
    }
  }
  return {
    discordConfigured: Boolean(alarmChannel),
    rustPlusConnected: status.connected && Boolean(status.activeServerId),
    customAlarmSoundConfigured,
  };
}

export async function getServerNotificationSettings(
  db: Database,
  serverId: string,
): Promise<ServerNotificationSettings> {
  const [server] = await db
    .select({ notificationSettingsJson: rustServers.notificationSettingsJson })
    .from(rustServers)
    .where(eq(rustServers.id, serverId))
    .limit(1);

  const raw = server?.notificationSettingsJson;
  if (!raw?.trim()) {
    const seeded = seedServerNotificationSettingsFromEnv();
    await db
      .update(rustServers)
      .set({
        notificationSettingsJson: JSON.stringify(seeded),
        updatedAt: new Date(),
      })
      .where(eq(rustServers.id, serverId));
    return seeded;
  }

  return parseServerNotificationSettings(raw);
}

export async function getActiveNotificationSettings(
  db: Database,
  rustPlus: RustPlusManager,
): Promise<NotificationSettingsResponse | null> {
  const activeFcm = await getActiveFcmCredential(db);
  if (!activeFcm) return null;

  const [server] = await db
    .select({
      id: rustServers.id,
      notificationSettingsJson: rustServers.notificationSettingsJson,
    })
    .from(rustServers)
    .where(
      and(eq(rustServers.isActive, true), eq(rustServers.fcmCredentialId, activeFcm.id)),
    )
    .limit(1);

  if (!server) return null;

  let settings = parseServerNotificationSettings(server.notificationSettingsJson);
  if (!server.notificationSettingsJson?.trim()) {
    settings = seedServerNotificationSettingsFromEnv();
    await db
      .update(rustServers)
      .set({
        notificationSettingsJson: JSON.stringify(settings),
        updatedAt: new Date(),
      })
      .where(eq(rustServers.id, server.id));
  }

  return {
    settings,
    capabilities: await notificationCapabilities(db, rustPlus),
  };
}

export async function updateActiveNotificationSettings(
  db: Database,
  patch: {
    smartAlarm?: Partial<ServerNotificationSettings["smartAlarm"]>;
    deepSea?: Partial<ServerNotificationSettings["deepSea"]>;
    tcDecay?: Partial<ServerNotificationSettings["tcDecay"]>;
    teamChatBot?: Partial<ServerNotificationSettings["teamChatBot"]>;
    teamActivity?: Partial<ServerNotificationSettings["teamActivity"]>;
    eventTimers?: Partial<ServerNotificationSettings["eventTimers"]>;
    automationBase?: Partial<ServerNotificationSettings["automationBase"]>;
    legacyAutomations?: Partial<ServerNotificationSettings["legacyAutomations"]>;
  },
): Promise<ServerNotificationSettings | null> {
  const activeFcm = await getActiveFcmCredential(db);
  if (!activeFcm) return null;

  const [server] = await db
    .select({
      id: rustServers.id,
      notificationSettingsJson: rustServers.notificationSettingsJson,
    })
    .from(rustServers)
    .where(
      and(eq(rustServers.isActive, true), eq(rustServers.fcmCredentialId, activeFcm.id)),
    )
    .limit(1);

  if (!server) return null;

  const next = mergeNotificationSettings(
    parseServerNotificationSettings(server.notificationSettingsJson),
    patch,
  );

  await db
    .update(rustServers)
    .set({
      notificationSettingsJson: JSON.stringify(next),
      updatedAt: new Date(),
    })
    .where(eq(rustServers.id, server.id));

  if (patch.teamActivity) {
    await pruneTeamEventLogsToLimits(db, server.id, next.teamActivity);
    trimTeamTrackerDeaths(server.id, next.teamActivity.deathLogLimit);
  }

  return next;
}

export async function updateTeamChatBotSettings(
  db: Database,
  serverId: string,
  patch: Partial<TeamChatBotSettings>,
): Promise<ServerNotificationSettings> {
  const current = await getServerNotificationSettings(db, serverId);
  const next = mergeNotificationSettings(current, { teamChatBot: patch });

  await db
    .update(rustServers)
    .set({
      notificationSettingsJson: JSON.stringify(next),
      updatedAt: new Date(),
    })
    .where(eq(rustServers.id, serverId));

  return next;
}

export async function resolveDiscordAlarmChannelId(db: Database): Promise<string> {
  return resolveDefaultGuildChannelId(db, "alarms");
}
