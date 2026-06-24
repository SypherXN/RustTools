import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
config({ path: path.resolve(repoRoot, ".env") });

function resolveRepoPath(relativePath: string): string {
  const raw = relativePath.replace(/^file:/, "");
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(repoRoot, raw);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  nodeEnv: optional("NODE_ENV", "development"),
  isDev: optional("NODE_ENV", "development") !== "production",
  apiPort: Number(optional("API_PORT", "3000")),
  apiHost: optional("API_HOST", "0.0.0.0"),
  apiPublicUrl: optional("API_PUBLIC_URL", "http://localhost:3000"),
  sessionSecret: optional("SESSION_SECRET", "dev-session-secret-change-me"),
  encryptionKey: optional("ENCRYPTION_KEY", "dev-encryption-key-32chars!!"),
  corsOrigins: optional("CORS_ORIGINS", "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  frontendUrl: optional("FRONTEND_URL", ""),
  databaseUrl: optional("DATABASE_URL", "file:./data/rusttools.db"),
  discord: {
    clientId: optional("DISCORD_CLIENT_ID"),
    clientSecret: optional("DISCORD_CLIENT_SECRET"),
    redirectUri: optional("DISCORD_REDIRECT_URI", "http://localhost:3000/auth/discord/callback"),
    botToken: optional("DISCORD_BOT_TOKEN"),
    guildId: optional("DISCORD_GUILD_ID"),
    roleAdmin: optional("DISCORD_ROLE_ADMIN").split(",").map((r) => r.trim()).filter(Boolean),
    roleSwitch: optional("DISCORD_ROLE_SWITCH").split(",").map((r) => r.trim()).filter(Boolean),
    roleView: optional("DISCORD_ROLE_VIEW").split(",").map((r) => r.trim()).filter(Boolean),
    notificationChannelId: optional("DISCORD_NOTIFICATION_CHANNEL_ID"),
  },
  internalApiKey: optional("INTERNAL_API_KEY"),
  rustplus: {
    fcmConfigPath: optional("RUSTPLUS_FCM_CONFIG_PATH", "./data/fcm-config.json"),
    get resolvedFcmConfigPath(): string {
      return resolveRepoPath(optional("RUSTPLUS_FCM_CONFIG_PATH", "./data/fcm-config.json"));
    },
  },
  get discordOAuthConfigured(): boolean {
    return Boolean(this.discord.clientId && this.discord.clientSecret);
  },
  get frontendRedirectUrl(): string {
    if (this.frontendUrl) return this.frontendUrl.replace(/\/$/, "");
    return this.corsOrigins[0]?.replace(/\/$/, "") ?? "http://localhost:5173";
  },
  get crossOriginFrontend(): boolean {
    try {
      const apiHost = new URL(this.apiPublicUrl).host;
      return this.corsOrigins.some((origin) => {
        try {
          return new URL(origin).host !== apiHost;
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  },
};

export function assertProductionSecrets(): void {
  if (!env.isDev) {
    required("SESSION_SECRET");
    required("ENCRYPTION_KEY");
  }
}
