CREATE TABLE `automation_rule_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`name` text NOT NULL,
	`trigger_json` text NOT NULL,
	`conditions_json` text DEFAULT '[]' NOT NULL,
	`actions_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `rust_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
