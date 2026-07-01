CREATE TABLE `team_board_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `server_id` text NOT NULL,
  `kind` text NOT NULL,
  `title` text NOT NULL,
  `content` text NOT NULL,
  `pinned` integer NOT NULL DEFAULT 0,
  `created_by` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`server_id`) REFERENCES `rust_servers`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_board_server_idx` ON `team_board_entries` (`server_id`);
