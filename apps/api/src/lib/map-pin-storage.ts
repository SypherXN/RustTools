import fs from "node:fs";
import path from "node:path";
import { env } from "../config.js";

export function resolveMapPinScreensDir(): string {
  const dbPath = env.databaseUrl.replace(/^file:/, "");
  const base = path.isAbsolute(dbPath)
    ? path.dirname(dbPath)
    : path.resolve(process.cwd(), path.dirname(dbPath));
  return path.join(base, "map-pins");
}

export function ensureMapPinScreensDir(): void {
  const dir = resolveMapPinScreensDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function pinScreenshotPath(pinId: string, ext = "jpg"): string {
  return path.join(resolveMapPinScreensDir(), `${pinId}.${ext}`);
}
