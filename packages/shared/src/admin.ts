export interface FcmCredentialStatus {
  configured: boolean;
  listening: boolean;
  registeredAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  warning: boolean;
  expired: boolean;
}

export interface FcmCredentialSummary {
  id: string;
  label: string;
  isActive: boolean;
  registeredAt: string;
  expiresAt: string;
  daysRemaining: number;
  warning: boolean;
  expired: boolean;
  listening: boolean;
  serverCount: number;
  activeServerName: string | null;
  masterPlayerId: string | null;
}

/** GCM push credentials from rustplus.js typically need refresh after ~90 days. */
export const FCM_CREDENTIAL_LIFETIME_DAYS = 90;
export const FCM_WARNING_DAYS_BEFORE = 14;

export const DATA_RESET_SCOPES = [
  "team_events",
  "world_event_state",
  "map_overlays",
  "automation_rules",
  "smart_devices",
  "server_pairing",
  "audit_log",
] as const;

export type DataResetScope = (typeof DATA_RESET_SCOPES)[number];

export const DATA_RESET_SCOPE_LABELS: Record<DataResetScope, string> = {
  team_events: "Team death & connection logs (auto-cleared on wipe)",
  world_event_state: "World event tracker state",
  map_overlays: "Map drawings & base pins",
  automation_rules: "Automation rules (templates kept)",
  smart_devices: "Paired smart devices, groups & library (templates kept)",
  server_pairing: "Active server pairing (disconnect Rust+; removes all server data)",
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

export interface AdminUserSummary {
  id: string;
  discordId: string;
  discordUsername: string;
  steamId: string | null;
  createdAt: string;
  blocked: boolean;
}
