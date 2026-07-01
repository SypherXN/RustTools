ALTER TABLE `team_board_entries` ADD COLUMN `category` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `team_board_global_entries` ADD COLUMN `category` text NOT NULL DEFAULT '';
