export interface FcmCredentialStatus {
  configured: boolean;
  listening: boolean;
  registeredAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  warning: boolean;
  expired: boolean;
}

export const DATA_RESET_SCOPES = [
  "team_events",
  "world_event_state",
  "storage_history",
  "map_overlays",
  "automation_rules",
  "smart_devices",
  "server_pairing",
  "audit_log",
] as const;

export type DataResetScope = (typeof DATA_RESET_SCOPES)[number];

export const DATA_RESET_SCOPE_LABELS: Record<DataResetScope, string> = {
  team_events: "Team death & connection logs",
  world_event_state: "World event tracker state",
  storage_history: "Storage snapshot history",
  map_overlays: "Map drawings & base pins",
  automation_rules: "Automation rules & templates",
  smart_devices: "Paired smart devices, groups & library",
  server_pairing: "Active server pairing (disconnect Rust+)",
  audit_log: "Audit log (all servers)",
};

export function isDataResetScope(value: string): value is DataResetScope {
  return (DATA_RESET_SCOPES as readonly string[]).includes(value);
}

export interface DiscordBlacklistEntry {
  id: string;
  guildId: string;
  discordId: string | null;
  steamId: string | null;
  reason: string;
  createdBy: string | null;
  createdAt: string;
}
