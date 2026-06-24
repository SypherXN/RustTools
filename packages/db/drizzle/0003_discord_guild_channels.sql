CREATE TABLE `discord_guild_channels` (
	`guild_id` text NOT NULL,
	`purpose` text NOT NULL,
	`channel_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `purpose`)
);
