import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });

export const env = {
  botToken: process.env.DISCORD_BOT_TOKEN ?? "",
  clientId: process.env.DISCORD_CLIENT_ID ?? "",
  guildId: process.env.DISCORD_GUILD_ID ?? "",
  apiPublicUrl: process.env.API_PUBLIC_URL ?? "http://localhost:3000",
  internalApiKey: process.env.INTERNAL_API_KEY ?? "",
  webUrl: process.env.CORS_ORIGINS?.split(",")[0] ?? "http://localhost:5173",
};

/** Base URL for bot → API (use http://api:3000 in Docker) */
export function apiBaseUrl(): string {
  return env.apiPublicUrl.replace(/\/$/, "");
}
