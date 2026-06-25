import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustServers } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import {
  mergeNotificationSettings,
  parseServerNotificationSettings,
  type NotificationSettingsCapabilities,
  type NotificationSettingsResponse,
  type ServerNotificationSettings,
  type TeamChatBotSettings,
} from "@rusttools/shared";
import { resolveDefaultGuildChannelId } from "./discord-channels.js";

export async function notificationCapabilities(
  db: Database,
  rustPlus: RustPlusManager,
): Promise<NotificationSettingsCapabilities> {
  const status = rustPlus.getStatus();
  const alarmChannel = await resolveDefaultGuildChannelId(db, "alarms");
  return {
    discordConfigured: Boolean(alarmChannel),
    rustPlusConnected: status.connected && Boolean(status.activeServerId),
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

  return parseServerNotificationSettings(server?.notificationSettingsJson);
}

export async function getActiveNotificationSettings(
  db: Database,
  rustPlus: RustPlusManager,
): Promise<NotificationSettingsResponse | null> {
  const [server] = await db
    .select({
      id: rustServers.id,
      notificationSettingsJson: rustServers.notificationSettingsJson,
    })
    .from(rustServers)
    .where(eq(rustServers.isActive, true))
    .limit(1);

  if (!server) return null;

  return {
    settings: parseServerNotificationSettings(server.notificationSettingsJson),
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
    eventTimers?: Partial<ServerNotificationSettings["eventTimers"]>;
    automationBase?: Partial<ServerNotificationSettings["automationBase"]>;
  },
): Promise<ServerNotificationSettings | null> {
  const [server] = await db
    .select({
      id: rustServers.id,
      notificationSettingsJson: rustServers.notificationSettingsJson,
    })
    .from(rustServers)
    .where(eq(rustServers.isActive, true))
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
