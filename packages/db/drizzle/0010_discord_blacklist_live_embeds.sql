CREATE TABLE `discord_blacklist` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`discord_id` text,
	`steam_id` text,
	`reason` text DEFAULT '' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL
);

CREATE TABLE `discord_live_embeds` (
	`guild_id` text NOT NULL,
	`purpose` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `purpose`)
);
