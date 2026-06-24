import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

/** Resolve file:./data/rusttools.db relative to the monorepo root. */
export function resolveDatabaseUrl(databaseUrl: string): string {
  const raw = databaseUrl.replace(/^file:/, "");
  if (path.isAbsolute(raw)) {
    return `file:${raw}`;
  }
  return `file:${path.resolve(repoRoot, raw)}`;
}

export function resolveDatabasePath(databaseUrl: string): string {
  return resolveDatabaseUrl(databaseUrl).replace(/^file:/, "");
}
