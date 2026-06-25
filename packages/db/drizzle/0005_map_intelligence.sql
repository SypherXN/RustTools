ALTER TABLE `rust_servers` ADD COLUMN `map_uploaded_at` integer;
--> statement-breakpoint
ALTER TABLE `rust_servers` ADD COLUMN `map_parsed_at` integer;
--> statement-breakpoint
ALTER TABLE `rust_servers` ADD COLUMN `map_parsed_cache_json` text;
--> statement-breakpoint
CREATE TABLE `map_drawings` (
  `id` text PRIMARY KEY NOT NULL,
  `server_id` text NOT NULL,
  `tool` text NOT NULL,
  `color` text NOT NULL,
  `width` integer NOT NULL,
  `points_json` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`server_id`) REFERENCES `rust_servers`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `map_pins` (
  `id` text PRIMARY KEY NOT NULL,
  `server_id` text NOT NULL,
  `label` text NOT NULL,
  `x` real NOT NULL,
  `y` real NOT NULL,
  `notes` text NOT NULL DEFAULT '',
  `screenshot_path` text,
  `created_by` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`server_id`) REFERENCES `rust_servers`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `map_drawings_server_idx` ON `map_drawings` (`server_id`);
--> statement-breakpoint
CREATE INDEX `map_pins_server_idx` ON `map_pins` (`server_id`);
