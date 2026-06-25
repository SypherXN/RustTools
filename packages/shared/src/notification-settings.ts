export interface SmartAlarmNotificationSettings {
  discord: boolean;
  teamChat: boolean;
}

export interface DeepSeaNotificationSettings {
  discord: boolean;
  teamChat: boolean;
}

export interface ServerNotificationSettings {
  smartAlarm: SmartAlarmNotificationSettings;
  deepSea: DeepSeaNotificationSettings;
  teamChatBot: TeamChatBotSettings;
}

export type { TeamChatBotSettings } from "./team-chat-control.js";
import type { TeamChatBotSettings } from "./team-chat-control.js";
import { DEFAULT_TEAM_CHAT_BOT_SETTINGS } from "./team-chat-control.js";

export interface NotificationSettingsCapabilities {
  discordConfigured: boolean;
  rustPlusConnected: boolean;
}

export interface NotificationSettingsResponse {
  settings: ServerNotificationSettings;
  capabilities: NotificationSettingsCapabilities;
}

export const DEFAULT_SERVER_NOTIFICATION_SETTINGS: ServerNotificationSettings = {
  smartAlarm: {
    discord: true,
    teamChat: false,
  },
  deepSea: {
    discord: true,
    teamChat: false,
  },
  teamChatBot: { ...DEFAULT_TEAM_CHAT_BOT_SETTINGS },
};

export function mergeNotificationSettings(
  current: ServerNotificationSettings,
  patch: {
    smartAlarm?: Partial<SmartAlarmNotificationSettings>;
    deepSea?: Partial<DeepSeaNotificationSettings>;
    teamChatBot?: Partial<TeamChatBotSettings>;
  },
): ServerNotificationSettings {
  return {
    smartAlarm: {
      ...current.smartAlarm,
      ...patch.smartAlarm,
    },
    deepSea: {
      ...current.deepSea,
      ...patch.deepSea,
    },
    teamChatBot: {
      ...current.teamChatBot,
      ...patch.teamChatBot,
    },
  };
}

export function parseServerNotificationSettings(
  raw: string | null | undefined,
): ServerNotificationSettings {
  if (!raw?.trim()) {
    return {
      smartAlarm: { ...DEFAULT_SERVER_NOTIFICATION_SETTINGS.smartAlarm },
      deepSea: { ...DEFAULT_SERVER_NOTIFICATION_SETTINGS.deepSea },
      teamChatBot: { ...DEFAULT_TEAM_CHAT_BOT_SETTINGS },
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ServerNotificationSettings>;
    return mergeNotificationSettings(DEFAULT_SERVER_NOTIFICATION_SETTINGS, {
      smartAlarm: parsed.smartAlarm,
      deepSea: parsed.deepSea,
      teamChatBot: parsed.teamChatBot,
    });
  } catch {
    return {
      smartAlarm: { ...DEFAULT_SERVER_NOTIFICATION_SETTINGS.smartAlarm },
      deepSea: { ...DEFAULT_SERVER_NOTIFICATION_SETTINGS.deepSea },
      teamChatBot: { ...DEFAULT_TEAM_CHAT_BOT_SETTINGS },
    };
  }
}

export function formatSmartAlarmTeamChatMessage(event: {
  title?: string;
  message?: string;
  body?: Record<string, unknown>;
}): string {
  const title = event.title?.trim() || "Smart Alarm";
  const message = event.message?.trim();
  const body = event.body ?? {};
  const entityName =
    (typeof body.entityName === "string" && body.entityName) ||
    (typeof body.name === "string" && body.name) ||
    null;

  if (entityName && message) return `[Alarm] ${entityName}: ${message}`;
  if (message) return `[Alarm] ${title}: ${message}`;
  if (entityName) return `[Alarm] ${entityName} triggered`;
  return `[Alarm] ${title}`;
}
