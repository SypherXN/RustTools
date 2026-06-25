import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";
import { resolveDatabaseUrl } from "./paths.js";

/** Apply pending SQL migrations (idempotent). */
export function runMigrations(databaseUrl: string): void {
  const resolved = resolveDatabaseUrl(databaseUrl);
  const dbPath = resolved.replace(/^file:/, "");
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });

  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");
  migrate(db, { migrationsFolder });
}
