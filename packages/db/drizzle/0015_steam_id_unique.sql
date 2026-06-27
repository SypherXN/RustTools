CREATE UNIQUE INDEX IF NOT EXISTS `users_steam_id_unique` ON `users` (`steam_id`) WHERE `steam_id` IS NOT NULL;
