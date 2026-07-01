CREATE TABLE `team_board_global_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `title` text NOT NULL,
  `content` text NOT NULL,
  `pinned` integer NOT NULL DEFAULT 0,
  `created_by` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
