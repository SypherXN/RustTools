export interface SmartAlarmNotificationSettings {
  discord: boolean;
  teamChat: boolean;
  /** Prefix Discord content with @everyone when enabled (#45). */
  pingEveryone: boolean;
  /** In-browser notification + optional siren when tab open (#124). */
  webPush: boolean;
  browserSiren: boolean;
  /** SMS/email escalation after Discord (#117). */
  escalation: SmartAlarmEscalationSettings;
}

export interface SmartAlarmEscalationSettings {
  enabled: boolean;
  /** E.164 phone numbers for Twilio SMS. */
  smsNumbers: string[];
  emailAddresses: string[];
}

export interface TcDecayNotificationSettings {
  discord: boolean;
  teamChat: boolean;
  pingEveryone: boolean;
  /** Alert when upkeep drops below this many hours (#48–49). */
  warningHours: number;
  /** Critical alert threshold (hours). */
  criticalHours: number;
  /** Poll interval in minutes for proactive TC checks. */
  pollIntervalMinutes: number;
}

export interface DeepSeaNotificationSettings {
  discord: boolean;
  teamChat: boolean;
}

/** Default base point for team proximity automations. */
export interface AutomationBaseSettings {
  x: number | null;
  y: number | null;
  /** Circular proximity radius in world meters (preferred). */
  radiusMeters?: number | null;
  /** @deprecated Legacy radius in 150 m units — use {@link radiusMeters}. */
  radiusGrid: number;
  mapPinId: string | null;
  label?: string;
}

export const DEFAULT_AUTOMATION_BASE_SETTINGS: AutomationBaseSettings = {
  x: null,
  y: null,
  radiusMeters: 150,
  radiusGrid: 1,
  mapPinId: null,
  label: "Base",
};

export type { TeamChatBotSettings } from "./team-chat-control.js";
export type { EventTimerSettings } from "./world-events.js";
import type { LegacyAutomationSettings } from "./legacy-automations.js";
import {
  DEFAULT_LEGACY_AUTOMATION_SETTINGS,
  legacyAutomationsFromEnv,
} from "./legacy-automations.js";
import type { TeamChatBotSettings } from "./team-chat-control.js";
import { DEFAULT_TEAM_CHAT_BOT_SETTINGS } from "./team-chat-control.js";
import type { EventTimerSettings } from "./world-events.js";
import { DEFAULT_EVENT_TIMER_SETTINGS } from "./world-events.js";

export interface ServerNotificationSettings {
  smartAlarm: SmartAlarmNotificationSettings;
  deepSea: DeepSeaNotificationSettings;
  tcDecay: TcDecayNotificationSettings;
  teamChatBot: TeamChatBotSettings;
  eventTimers: EventTimerSettings;
  automationBase: AutomationBaseSettings;
  legacyAutomations: LegacyAutomationSettings;
}

export const DEFAULT_SMART_ALARM_ESCALATION: SmartAlarmEscalationSettings = {
  enabled: false,
  smsNumbers: [],
  emailAddresses: [],
};

export interface NotificationSettingsCapabilities {
  discordConfigured: boolean;
  rustPlusConnected: boolean;
}

export interface NotificationSettingsResponse {
  settings: ServerNotificationSettings;
  capabilities: NotificationSettingsCapabilities;
}

export const DEFAULT_TC_DECAY_SETTINGS: TcDecayNotificationSettings = {
  discord: true,
  teamChat: true,
  pingEveryone: false,
  warningHours: 24,
  criticalHours: 6,
  pollIntervalMinutes: 15,
};

export const DEFAULT_SERVER_NOTIFICATION_SETTINGS: ServerNotificationSettings = {
  smartAlarm: {
    discord: true,
    teamChat: false,
    pingEveryone: false,
    webPush: true,
    browserSiren: true,
    escalation: { ...DEFAULT_SMART_ALARM_ESCALATION },
  },
  deepSea: {
    discord: true,
    teamChat: false,
  },
  tcDecay: { ...DEFAULT_TC_DECAY_SETTINGS },
  teamChatBot: { ...DEFAULT_TEAM_CHAT_BOT_SETTINGS },
  eventTimers: { ...DEFAULT_EVENT_TIMER_SETTINGS },
  automationBase: { ...DEFAULT_AUTOMATION_BASE_SETTINGS },
  legacyAutomations: { ...DEFAULT_LEGACY_AUTOMATION_SETTINGS },
};

export function mergeNotificationSettings(
  current: ServerNotificationSettings,
  patch: {
    smartAlarm?: Partial<SmartAlarmNotificationSettings>;
    deepSea?: Partial<DeepSeaNotificationSettings>;
    tcDecay?: Partial<TcDecayNotificationSettings>;
    teamChatBot?: Partial<TeamChatBotSettings>;
    eventTimers?: Partial<EventTimerSettings>;
    automationBase?: Partial<AutomationBaseSettings>;
    legacyAutomations?: Partial<LegacyAutomationSettings> & {
      nightLights?: Partial<LegacyAutomationSettings["nightLights"]>;
      teamOfflineSam?: Partial<LegacyAutomationSettings["teamOfflineSam"]>;
      mapEvents?: Partial<LegacyAutomationSettings["mapEvents"]>;
    };
  },
): ServerNotificationSettings {
  const legacyPatch = patch.legacyAutomations;
  return {
    smartAlarm: {
      ...current.smartAlarm,
      ...patch.smartAlarm,
      escalation: {
        ...current.smartAlarm.escalation,
        ...patch.smartAlarm?.escalation,
      },
    },
    deepSea: {
      ...current.deepSea,
      ...patch.deepSea,
    },
    tcDecay: {
      ...current.tcDecay,
      ...patch.tcDecay,
    },
    teamChatBot: {
      ...current.teamChatBot,
      ...patch.teamChatBot,
    },
    eventTimers: {
      ...current.eventTimers,
      ...patch.eventTimers,
    },
    automationBase: {
      ...current.automationBase,
      ...patch.automationBase,
    },
    legacyAutomations: {
      nightLights: {
        ...current.legacyAutomations.nightLights,
        ...legacyPatch?.nightLights,
      },
      teamOfflineSam: {
        ...current.legacyAutomations.teamOfflineSam,
        ...legacyPatch?.teamOfflineSam,
      },
      mapEvents: {
        ...current.legacyAutomations.mapEvents,
        ...legacyPatch?.mapEvents,
      },
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
      tcDecay: { ...DEFAULT_TC_DECAY_SETTINGS },
      teamChatBot: { ...DEFAULT_TEAM_CHAT_BOT_SETTINGS },
      eventTimers: { ...DEFAULT_EVENT_TIMER_SETTINGS },
      automationBase: { ...DEFAULT_AUTOMATION_BASE_SETTINGS },
      legacyAutomations: legacyAutomationsFromEnv(),
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ServerNotificationSettings>;
    const envLegacy = legacyAutomationsFromEnv();
    return mergeNotificationSettings(DEFAULT_SERVER_NOTIFICATION_SETTINGS, {
      smartAlarm: parsed.smartAlarm,
      deepSea: parsed.deepSea,
      tcDecay: parsed.tcDecay,
      teamChatBot: parsed.teamChatBot,
      eventTimers: parsed.eventTimers,
      automationBase: parsed.automationBase,
      legacyAutomations: parsed.legacyAutomations ?? envLegacy,
    });
  } catch {
    return {
      smartAlarm: { ...DEFAULT_SERVER_NOTIFICATION_SETTINGS.smartAlarm },
      deepSea: { ...DEFAULT_SERVER_NOTIFICATION_SETTINGS.deepSea },
      tcDecay: { ...DEFAULT_TC_DECAY_SETTINGS },
      teamChatBot: { ...DEFAULT_TEAM_CHAT_BOT_SETTINGS },
      eventTimers: { ...DEFAULT_EVENT_TIMER_SETTINGS },
      automationBase: { ...DEFAULT_AUTOMATION_BASE_SETTINGS },
      legacyAutomations: legacyAutomationsFromEnv(),
    };
  }
}

export function formatSmartAlarmTeamChatMessage(
  event: {
    title?: string;
    message?: string;
    body?: Record<string, unknown>;
  },
  customMessage?: string | null,
  entityName?: string | null,
): string {
  if (customMessage?.trim()) {
    return customMessage.trim();
  }

  const title = event.title?.trim() || "Smart Alarm";
  const message = event.message?.trim();
  const body = event.body ?? {};
  const resolvedName =
    entityName ??
    ((typeof body.entityName === "string" && body.entityName) ||
      (typeof body.name === "string" && body.name) ||
      null);

  if (resolvedName && message) return `[Alarm] ${resolvedName}: ${message}`;
  if (message) return `[Alarm] ${title}: ${message}`;
  if (resolvedName) return `[Alarm] ${resolvedName} triggered`;
  return `[Alarm] ${title}`;
}

export function formatTcDecayAlertMessage(
  tcName: string,
  upkeepLabel: string,
  level: "warning" | "critical",
): string {
  const prefix = level === "critical" ? "[TC CRITICAL]" : "[TC Warning]";
  return `${prefix} ${tcName}: ${upkeepLabel} of upkeep remaining`;
}
