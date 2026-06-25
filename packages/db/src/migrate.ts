import { runMigrations } from "./run-migrations.js";

const databaseUrl = process.env.DATABASE_URL ?? "file:./data/rusttools.db";
runMigrations(databaseUrl);
console.log("Migrations applied successfully.");
