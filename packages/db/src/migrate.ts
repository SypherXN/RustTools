import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "./index.js";
import { resolveDatabaseUrl } from "./paths.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const databaseUrl = resolveDatabaseUrl(process.env.DATABASE_URL ?? "file:./data/rusttools.db");
const dbPath = databaseUrl.replace(/^file:/, "");
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = createDatabase(databaseUrl);
const migrationsFolder = path.join(__dirname, "../drizzle");

migrate(db, { migrationsFolder });
console.log("Migrations applied successfully.");
