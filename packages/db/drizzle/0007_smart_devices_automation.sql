ALTER TABLE `rust_entities` ADD COLUMN `settings_json` text;
--> statement-breakpoint
CREATE TABLE `switch_groups` (
  `id` text PRIMARY KEY NOT NULL,
  `server_id` text NOT NULL,
  `name` text NOT NULL,
  `display_name` text,
  `chat_command` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`server_id`) REFERENCES `rust_servers`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `switch_group_members` (
  `group_id` text NOT NULL,
  `entity_id` text NOT NULL,
  PRIMARY KEY (`group_id`, `entity_id`),
  FOREIGN KEY (`group_id`) REFERENCES `switch_groups`(`id`) ON DELETE cascade,
  FOREIGN KEY (`entity_id`) REFERENCES `rust_entities`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `device_library_groups` (
  `id` text PRIMARY KEY NOT NULL,
  `server_id` text NOT NULL,
  `parent_id` text,
  `name` text NOT NULL,
  `sort_order` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`server_id`) REFERENCES `rust_servers`(`id`) ON DELETE cascade,
  FOREIGN KEY (`parent_id`) REFERENCES `device_library_groups`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `device_library_members` (
  `group_id` text NOT NULL,
  `entity_id` text NOT NULL,
  PRIMARY KEY (`group_id`, `entity_id`),
  FOREIGN KEY (`group_id`) REFERENCES `device_library_groups`(`id`) ON DELETE cascade,
  FOREIGN KEY (`entity_id`) REFERENCES `rust_entities`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `automation_rules` (
  `id` text PRIMARY KEY NOT NULL,
  `server_id` text NOT NULL,
  `name` text NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `trigger_json` text NOT NULL,
  `conditions_json` text NOT NULL DEFAULT '[]',
  `actions_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`server_id`) REFERENCES `rust_servers`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `switch_scheduled_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `server_id` text NOT NULL,
  `entity_id` text NOT NULL,
  `revert_value` integer NOT NULL,
  `run_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`server_id`) REFERENCES `rust_servers`(`id`) ON DELETE cascade,
  FOREIGN KEY (`entity_id`) REFERENCES `rust_entities`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `saved_cameras` (
  `id` text PRIMARY KEY NOT NULL,
  `server_id` text NOT NULL,
  `camera_id` text NOT NULL,
  `label` text NOT NULL,
  `library_group_id` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`server_id`) REFERENCES `rust_servers`(`id`) ON DELETE cascade,
  FOREIGN KEY (`library_group_id`) REFERENCES `device_library_groups`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `switch_scheduled_jobs_run_at_idx` ON `switch_scheduled_jobs` (`run_at`);
