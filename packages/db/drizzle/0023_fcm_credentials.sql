CREATE TABLE `fcm_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`config_encrypted` text NOT NULL,
	`registered_at` integer NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

ALTER TABLE `rust_servers` ADD `fcm_credential_id` text REFERENCES `fcm_credentials`(`id`) ON DELETE CASCADE;
