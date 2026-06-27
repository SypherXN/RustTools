import type { UserCapabilities } from "./permissions.js";

export type EntityType = "smart_switch" | "smart_alarm" | "storage_monitor";

export type PendingLinkType = "steam" | "companion" | "master";

export interface User {
  id: string;
  discordId: string;
  discordUsername: string;
  discordAvatar: string | null;
  steamId: string | null;
  pendingLinkType?: PendingLinkType | null;
  companionPlayerId?: string | null;
  companionLinkedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthUserResponse {
  user: Pick<User, "id" | "discordId" | "discordUsername" | "discordAvatar" | "steamId"> & {
    companionPlayerId?: string | null;
  };
  linkedRust: boolean;
  linkedSteam: boolean;
  companionLinked: boolean;
  pendingLinkType?: PendingLinkType | null;
  permissions: UserCapabilities;
  rolesConfigured: boolean;
}

export interface Session {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface RustServer {
  id: string;
  name: string;
  ip: string;
  port: number;
  playerId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RustEntity {
  id: string;
  serverId: string;
  entityId: number;
  entityType: EntityType;
  name: string;
  displayName: string | null;
  icon: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiHealth {
  status: "ok" | "degraded";
  version: string;
  uptime: number;
  rustplus: {
    connected: boolean;
    activeServerId: string | null;
  };
  fcm: {
    listening: boolean;
    configured?: boolean;
    daysRemaining?: number | null;
    warning?: boolean;
    expired?: boolean;
    expiresAt?: string | null;
  };
}

// Event bus types for extensibility
export type RustPlusEvent =
  | { type: "entityChanged"; serverId: string; entityId: number; payload: unknown }
  | { type: "connectionLost"; serverId: string; reason: string }
  | { type: "connectionRestored"; serverId: string }
  | {
      type: "teamChat";
      serverId: string;
      message: string;
      steamId: string;
      name: string;
      sentAt: number;
    }
  | { type: "teamChanged"; serverId: string; teamInfo: unknown }
  | { type: "serverPaired"; serverId: string; name: string }
  | { type: "entityPaired"; serverId: string; entityId: number; entityType: EntityType; name: string }
  | { type: "mapMarkers"; serverId: string; markers: unknown }
  | { type: "fcmAlarm"; title?: string; message?: string; body: Record<string, unknown> }
  | {
      type: "cameraFrame";
      serverId: string;
      cameraId: string;
      frameBase64: string;
    };

export type RustPlusEventType = RustPlusEvent["type"];

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  type: "night_lights" | "team_offline_sam";
  switchEntityIds: number[];
}
