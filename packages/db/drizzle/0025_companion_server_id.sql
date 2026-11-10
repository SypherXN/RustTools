-- Companion relay server GUID. NULL keeps the legacy direct ip:port path.
-- Added in place so existing servers and child rows keep their primary keys.
ALTER TABLE `rust_servers` ADD COLUMN `companion_server_id` text;
