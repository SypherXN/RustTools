import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  discordId: text("discord_id").notNull().unique(),
  discordUsername: text("discord_username").notNull(),
  discordAvatar: text("discord_avatar"),
  steamId: text("steam_id"),
  pendingRustLink: integer("pending_rust_link", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const rustServers = sqliteTable("rust_servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ip: text("ip").notNull(),
  port: integer("port").notNull(),
  playerId: text("player_id").notNull(),
  playerTokenEncrypted: text("player_token_encrypted").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const rustEntities = sqliteTable("rust_entities", {
  id: text("id").primaryKey(),
  serverId: text("server_id")
    .notNull()
    .references(() => rustServers.id, { onDelete: "cascade" }),
  entityId: integer("entity_id").notNull(),
  entityType: text("entity_type").notNull(),
  name: text("name").notNull(),
  displayName: text("display_name"),
  icon: text("icon"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  metadata: text("metadata"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const storageSnapshots = sqliteTable("storage_snapshots", {
  id: text("id").primaryKey(),
  entityId: text("entity_id")
    .notNull()
    .references(() => rustEntities.id, { onDelete: "cascade" }),
  contentsJson: text("contents_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
