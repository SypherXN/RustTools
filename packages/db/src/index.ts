import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export function createDatabase(databaseUrl: string) {
  const path = databaseUrl.replace(/^file:/, "");
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export type Database = ReturnType<typeof createDatabase>;

export * from "./schema.js";
