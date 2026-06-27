ALTER TABLE `users` ADD `pending_link_type` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `companion_player_id` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `companion_token_encrypted` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `companion_linked_at` integer;
--> statement-breakpoint
UPDATE `users` SET `pending_link_type` = 'steam' WHERE `pending_rust_link` = 1 AND `pending_link_type` IS NULL;
