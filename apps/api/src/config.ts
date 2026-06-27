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

const DEV_SESSION_SECRET = "dev-session-secret-change-me";
const DEV_ENCRYPTION_KEY = "dev-encryption-key-32chars!!";
const DEV_INTERNAL_API_KEY = "change-me-internal-api-key";

export const env = {
  nodeEnv: optional("NODE_ENV", "development"),
  isDev: optional("NODE_ENV", "development") !== "production",
  apiPort: Number(optional("API_PORT", "3000")),
  apiHost: optional("API_HOST", "0.0.0.0"),
  apiPublicUrl: optional("API_PUBLIC_URL", "http://localhost:3000"),
  sessionSecret: optional("SESSION_SECRET", DEV_SESSION_SECRET),
  encryptionKey: optional("ENCRYPTION_KEY", DEV_ENCRYPTION_KEY),
  corsOrigins: optional("CORS_ORIGINS", "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  frontendUrl: optional("FRONTEND_URL", ""),
  databaseUrl: optional("DATABASE_URL", "file:./data/rusttools.db"),
  get dataDir(): string {
    return resolveRepoPath(optional("DATA_DIR", "./data"));
  },
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
  webPush: {
    publicKey: optional("VAPID_PUBLIC_KEY"),
    privateKey: optional("VAPID_PRIVATE_KEY"),
    subject: optional("VAPID_SUBJECT", "mailto:admin@localhost"),
  },
  twilio: {
    accountSid: optional("TWILIO_ACCOUNT_SID"),
    authToken: optional("TWILIO_AUTH_TOKEN"),
    fromNumber: optional("TWILIO_FROM_NUMBER"),
  },
  sendgrid: {
    apiKey: optional("SENDGRID_API_KEY"),
    fromEmail: optional("SENDGRID_FROM_EMAIL", "alerts@localhost"),
  },
  rustplus: {
    fcmConfigPath: optional("RUSTPLUS_FCM_CONFIG_PATH", "./data/fcm-config.json"),
    /** Dev-only: accept server pairs without an admin pending master link. Never enabled in production. */
    get allowUnpromptedPair(): boolean {
      if (optional("NODE_ENV", "development") === "production") return false;
      return optional("RUSTPLUS_ALLOW_UNPROMPTED_PAIR", "true") === "true";
    },
    get resolvedFcmConfigPath(): string {
      return resolveRepoPath(optional("RUSTPLUS_FCM_CONFIG_PATH", "./data/fcm-config.json"));
    },
  },
  /** Max HTTP requests per client IP per minute (Fastify @fastify/rate-limit). */
  apiRateLimitMax: Number(optional("API_RATE_LIMIT_MAX", "600")),
  /** Heap limit (MB) for the isolated procgen parse child process (default suits Oracle A1 12 GB). */
  procgenParseHeapMb: Number(optional("PROCGEN_PARSE_HEAP_MB", "4096")),
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
  if (env.isDev) return;

  required("SESSION_SECRET");
  required("ENCRYPTION_KEY");

  if (env.sessionSecret === DEV_SESSION_SECRET) {
    throw new Error("SESSION_SECRET must not use the development default in production");
  }
  if (env.encryptionKey === DEV_ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY must not use the development default in production");
  }
}

export function assertProductionDiscordRoles(): void {
  if (env.isDev) return;

  const hasRole =
    env.discord.roleAdmin.length > 0 ||
    env.discord.roleSwitch.length > 0 ||
    env.discord.roleView.length > 0;

  if (!hasRole) {
    throw new Error(
      "Set at least one of DISCORD_ROLE_ADMIN, DISCORD_ROLE_SWITCH, or DISCORD_ROLE_VIEW in production",
    );
  }
}

export function assertProductionRustPlusPairing(): void {
  if (env.isDev) return;

  if (process.env.RUSTPLUS_ALLOW_UNPROMPTED_PAIR === "true") {
    throw new Error(
      "RUSTPLUS_ALLOW_UNPROMPTED_PAIR cannot be enabled in production — use Settings → Re-pair Server instead",
    );
  }
}

export function assertProductionDiscordGuildId(): void {
  if (env.isDev) return;

  if (!env.discord.guildId?.trim()) {
    throw new Error(
      "DISCORD_GUILD_ID is required in production — user blocking and guild-scoped Discord features depend on it",
    );
  }
}

export function assertProductionInternalApiKey(): void {
  if (env.isDev) return;

  required("INTERNAL_API_KEY");
  const key = env.internalApiKey.trim();

  if (key === DEV_INTERNAL_API_KEY) {
    throw new Error("INTERNAL_API_KEY must not use the example default in production");
  }
  if (key.length < 32) {
    throw new Error("INTERNAL_API_KEY must be at least 32 characters in production");
  }
}
