CREATE UNIQUE INDEX `users_companion_player_id_unique` ON `users` (`companion_player_id`) WHERE `companion_player_id` IS NOT NULL;
