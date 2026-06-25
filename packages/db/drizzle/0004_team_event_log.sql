CREATE TABLE `team_death_log` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`steam_id` text NOT NULL,
	`name` text NOT NULL,
	`death_time` integer NOT NULL,
	`x` integer,
	`y` integer,
	`grid` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `rust_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_death_log_server_death_time_idx` ON `team_death_log` (`server_id`,`death_time`);
--> statement-breakpoint
CREATE TABLE `team_connection_log` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`steam_id` text NOT NULL,
	`name` text NOT NULL,
	`event` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `rust_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_connection_log_server_occurred_idx` ON `team_connection_log` (`server_id`,`occurred_at`);
