import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

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
  notificationSettingsJson: text("notification_settings_json"),
  worldEventStateJson: text("world_event_state_json"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const mapDrawings = sqliteTable("map_drawings", {
  id: text("id").primaryKey(),
  serverId: text("server_id")
    .notNull()
    .references(() => rustServers.id, { onDelete: "cascade" }),
  tool: text("tool").notNull(),
  color: text("color").notNull(),
  width: integer("width").notNull(),
  pointsJson: text("points_json").notNull(),
  label: text("label").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const mapPins = sqliteTable("map_pins", {
  id: text("id").primaryKey(),
  serverId: text("server_id")
    .notNull()
    .references(() => rustServers.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  x: integer("x", { mode: "number" }).notNull(),
  y: integer("y", { mode: "number" }).notNull(),
  notes: text("notes").notNull().default(""),
  screenshotPath: text("screenshot_path"),
  createdBy: text("created_by").notNull(),
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
  settingsJson: text("settings_json"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const switchGroups = sqliteTable("switch_groups", {
  id: text("id").primaryKey(),
  serverId: text("server_id")
    .notNull()
    .references(() => rustServers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  displayName: text("display_name"),
  chatCommand: text("chat_command"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const switchGroupMembers = sqliteTable(
  "switch_group_members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => switchGroups.id, { onDelete: "cascade" }),
    entityId: text("entity_id")
      .notNull()
      .references(() => rustEntities.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.groupId, table.entityId] }),
  }),
);

export const deviceLibraryGroups = sqliteTable("device_library_groups", {
  id: text("id").primaryKey(),
  serverId: text("server_id")
    .notNull()
    .references(() => rustServers.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const deviceLibraryMembers = sqliteTable(
  "device_library_members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => deviceLibraryGroups.id, { onDelete: "cascade" }),
    entityId: text("entity_id")
      .notNull()
      .references(() => rustEntities.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.groupId, table.entityId] }),
  }),
);

export const automationRules = sqliteTable("automation_rules", {
  id: text("id").primaryKey(),
  serverId: text("server_id")
    .notNull()
    .references(() => rustServers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  triggerJson: text("trigger_json").notNull(),
  conditionsJson: text("conditions_json").notNull().default("[]"),
  actionsJson: text("actions_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const automationRuleTemplates = sqliteTable("automation_rule_templates", {
  id: text("id").primaryKey(),
  serverId: text("server_id")
    .notNull()
    .references(() => rustServers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  triggerJson: text("trigger_json").notNull(),
  conditionsJson: text("conditions_json").notNull().default("[]"),
  actionsJson: text("actions_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const switchScheduledJobs = sqliteTable("switch_scheduled_jobs", {
  id: text("id").primaryKey(),
  serverId: text("server_id")
    .notNull()
    .references(() => rustServers.id, { onDelete: "cascade" }),
  entityId: text("entity_id")
    .notNull()
    .references(() => rustEntities.id, { onDelete: "cascade" }),
  revertValue: integer("revert_value", { mode: "boolean" }).notNull(),
  runAt: integer("run_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const savedCameras = sqliteTable("saved_cameras", {
  id: text("id").primaryKey(),
  serverId: text("server_id")
    .notNull()
    .references(() => rustServers.id, { onDelete: "cascade" }),
  cameraId: text("camera_id").notNull(),
  label: text("label").notNull(),
  libraryGroupId: text("library_group_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
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

export const discordGuildChannels = sqliteTable(
  "discord_guild_channels",
  {
    guildId: text("guild_id").notNull(),
    purpose: text("purpose").notNull(),
    channelId: text("channel_id").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.guildId, table.purpose] }),
  }),
);

export const teamDeathLog = sqliteTable("team_death_log", {
  id: text("id").primaryKey(),
  serverId: text("server_id")
    .notNull()
    .references(() => rustServers.id, { onDelete: "cascade" }),
  steamId: text("steam_id").notNull(),
  name: text("name").notNull(),
  deathTime: integer("death_time").notNull(),
  x: integer("x"),
  y: integer("y"),
  grid: text("grid"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const teamConnectionLog = sqliteTable("team_connection_log", {
  id: text("id").primaryKey(),
  serverId: text("server_id")
    .notNull()
    .references(() => rustServers.id, { onDelete: "cascade" }),
  steamId: text("steam_id").notNull(),
  name: text("name").notNull(),
  event: text("event").notNull(),
  occurredAt: integer("occurred_at").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const discordBlacklist = sqliteTable("discord_blacklist", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  discordId: text("discord_id"),
  steamId: text("steam_id"),
  reason: text("reason").notNull().default(""),
  createdBy: text("created_by"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const discordLiveEmbeds = sqliteTable(
  "discord_live_embeds",
  {
    guildId: text("guild_id").notNull(),
    purpose: text("purpose").notNull(),
    channelId: text("channel_id").notNull(),
    messageId: text("message_id").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.guildId, table.purpose] }),
  }),
);

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
