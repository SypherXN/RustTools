ALTER TABLE `rust_servers` ADD COLUMN `map_file_path` text;
--> statement-breakpoint
ALTER TABLE `rust_servers` ADD COLUMN `map_uploaded_at` integer;
--> statement-breakpoint
ALTER TABLE `rust_servers` ADD COLUMN `map_seed` integer;
--> statement-breakpoint
ALTER TABLE `rust_servers` ADD COLUMN `map_world_size` integer;
--> statement-breakpoint
ALTER TABLE `rust_servers` ADD COLUMN `map_parse_status` text;
--> statement-breakpoint
ALTER TABLE `rust_servers` ADD COLUMN `map_parse_error` text;
--> statement-breakpoint
ALTER TABLE `rust_servers` ADD COLUMN `map_parsed_at` integer;
--> statement-breakpoint
CREATE TABLE `map_footprints` (
  `id` text PRIMARY KEY NOT NULL,
  `server_id` text NOT NULL,
  `label` text NOT NULL,
  `pieces_json` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`server_id`) REFERENCES `rust_servers`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `map_footprints_server_idx` ON `map_footprints` (`server_id`);
