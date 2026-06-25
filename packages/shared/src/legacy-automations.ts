/** Legacy env automations (#115) — stored per server, env used as initial defaults. */

export interface NightLightsAutomationSettings {
  enabled: boolean;
  /** Rust+ entity IDs for smart switches. */
  entityIds: number[];
}

export interface TeamOfflineSamSettings {
  enabled: boolean;
  switchEntityId: number | null;
}

export interface MapEventAutomationSettings {
  teamChat: boolean;
  /** When null, defaults to same as teamChat. */
  discord: boolean | null;
  types: string[];
  prefix: string;
}

export interface LegacyAutomationSettings {
  nightLights: NightLightsAutomationSettings;
  teamOfflineSam: TeamOfflineSamSettings;
  mapEvents: MapEventAutomationSettings;
}

export const DEFAULT_MAP_EVENT_TYPES = [
  "cargo",
  "heli",
  "chinook",
  "vendor",
  "oil",
  "bradley",
  "convoy",
];

export const DEFAULT_LEGACY_AUTOMATION_SETTINGS: LegacyAutomationSettings = {
  nightLights: { enabled: false, entityIds: [] },
  teamOfflineSam: { enabled: false, switchEntityId: null },
  mapEvents: {
    teamChat: false,
    discord: null,
    types: [...DEFAULT_MAP_EVENT_TYPES],
    prefix: "RustTools",
  },
};

export function legacyAutomationsFromEnv(): LegacyAutomationSettings {
  const entityIds = (process.env.AUTOMATION_NIGHT_LIGHT_ENTITY_IDS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));

  const samRaw = process.env.AUTOMATION_SAM_SWITCH_ENTITY_ID?.trim();
  const samId = samRaw ? Number(samRaw) : NaN;

  const typesRaw =
    process.env.AUTOMATION_EVENT_TYPES?.trim() ||
    process.env.AUTOMATION_EVENT_TEAM_CHAT_TYPES?.trim();
  const types = typesRaw
    ? typesRaw.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_MAP_EVENT_TYPES;

  const teamChat = process.env.AUTOMATION_EVENT_TEAM_CHAT === "true";
  const discordExplicit = process.env.AUTOMATION_EVENT_DISCORD?.trim().toLowerCase();
  let discord: boolean | null = null;
  if (discordExplicit === "true") discord = true;
  if (discordExplicit === "false") discord = false;

  return {
    nightLights: {
      enabled: process.env.AUTOMATION_NIGHT_LIGHTS === "true",
      entityIds,
    },
    teamOfflineSam: {
      enabled: process.env.AUTOMATION_TEAM_OFFLINE_SAM === "true",
      switchEntityId: Number.isNaN(samId) ? null : samId,
    },
    mapEvents: {
      teamChat,
      discord,
      types: types.length ? types : [...DEFAULT_MAP_EVENT_TYPES],
      prefix: process.env.AUTOMATION_EVENT_TEAM_CHAT_PREFIX?.trim() || "RustTools",
    },
  };
}

export function resolveMapEventAutomationSettings(
  stored?: Partial<MapEventAutomationSettings> | null,
): MapEventAutomationSettings {
  const env = legacyAutomationsFromEnv().mapEvents;
  const merged = { ...env, ...stored };
  if (stored?.types?.length) merged.types = stored.types;
  return merged;
}

export function mapEventTeamChatEnabled(settings: MapEventAutomationSettings): boolean {
  return settings.teamChat;
}

export function mapEventDiscordEnabled(settings: MapEventAutomationSettings): boolean {
  if (settings.discord === true) return true;
  if (settings.discord === false) return false;
  return settings.teamChat;
}

export function mapEventAlertsEnabled(settings: MapEventAutomationSettings): boolean {
  return mapEventTeamChatEnabled(settings) || mapEventDiscordEnabled(settings);
}
