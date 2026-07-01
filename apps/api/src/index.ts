import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import path from "node:path";
import fs from "node:fs";
import { createDatabase, resolveDatabasePath, runMigrations } from "@rusttools/db";
import { users } from "@rusttools/db";
import { eq } from "drizzle-orm";
import { NotificationService, RustPlusManager } from "@rusttools/rustplus-client";
import { env, assertProductionDiscordGuildId, assertProductionDiscordRoles, assertProductionInternalApiKey, assertProductionRustPlusPairing, assertProductionSecrets } from "./config.js";
import { getSessionUser } from "./lib/auth.js";
import { hasDiscordCapability } from "./lib/discord-permissions.js";
import { isUserBlocked } from "./lib/user-access.js";
import { consumeWsToken } from "./lib/ws-tokens.js";
import { registerRoutes } from "./routes/index.js";
import { handleFcmNotification } from "./services/fcm-handler.js";
import { startPhase2Listeners } from "./services/phase2-listeners.js";
import { startInformationEmbedUpdater } from "./services/information-embed-updater.js";
import { startDataRetention } from "./services/data-retention.js";
import { reconnectStoredServers } from "./services/rustplus-bootstrap.js";
import { WsHub } from "./services/ws-hub.js";
import { postDiscordMessage } from "./lib/discord-messages.js";

async function sendDiscordMessage(notification: {
  channelId: string;
  content?: string;
  embed?: {
    title?: string;
    description?: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  };
  components?: Array<{
    type: number;
    components: Array<{ type: number; style: number; label: string; custom_id: string }>;
  }>;
}): Promise<void> {
  await postDiscordMessage(notification);
}

async function main() {
  assertProductionSecrets();
  assertProductionDiscordRoles();
  assertProductionDiscordGuildId();
  assertProductionInternalApiKey();
  assertProductionRustPlusPairing();

  const dbPath = resolveDatabasePath(env.databaseUrl);
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  runMigrations(env.databaseUrl);
  const db = createDatabase(`file:${dbPath}`);
  const wsHub = new WsHub();

  const notifications = new NotificationService({
    discord: sendDiscordMessage,
    webSocket: (msg) => wsHub.broadcast(msg.event, msg.payload),
  });

  const rustPlus = new RustPlusManager({
    fcmConfigPath: env.rustplus.resolvedFcmConfigPath,
    notificationService: notifications,
  });

  const app = Fastify({
    logger: { level: env.isDev ? "info" : "warn" },
    // Map drawings can include thousands of points; default 1 MB is too small.
    bodyLimit: 10 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: env.corsOrigins,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  await app.register(cookie, { secret: env.sessionSecret });
  await app.register(rateLimit, {
    max: env.apiRateLimitMax,
    timeWindow: "1 minute",
    allowList: (req) => req.method === "OPTIONS",
  });
  await app.register(websocket);

  app.get("/ws", { websocket: true }, async (socket, request) => {
    const query = request.query as { token?: string };
    let user = await getSessionUser(db, request);

    if (!user && query.token) {
      const userId = consumeWsToken(query.token);
      if (userId) {
        const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        user = row ?? null;
      }
    }

    if (!user) {
      socket.close(4401, "Unauthorized");
      return;
    }

    if (!(await hasDiscordCapability(user.discordId, "view"))) {
      socket.close(4403, "Forbidden");
      return;
    }

    if (await isUserBlocked(db, user)) {
      socket.close(4403, "Forbidden");
      return;
    }

    wsHub.add(socket);
    socket.send(JSON.stringify({ event: "connected", payload: { ok: true } }));
  });

  await registerRoutes(app, { db, rustPlus });

  rustPlus.startConnectionWatchdog();

  startPhase2Listeners(db, rustPlus, notifications);
  startInformationEmbedUpdater(db, rustPlus);
  startDataRetention(db);

  const fcmPath = env.rustplus.resolvedFcmConfigPath;
  if (fs.existsSync(fcmPath)) {
    rustPlus.startFcmListener((notification) => {
      void handleFcmNotification(db, rustPlus, notification, notifications).catch((err) => {
        app.log.error(err, "FCM notification handler failed");
      });
    });
  } else {
    app.log.warn("FCM config not found — pairing listener disabled until fcm-register completes");
  }

  await app.listen({ port: env.apiPort, host: env.apiHost });
  app.log.info(`API listening on ${env.apiPublicUrl}`);

  void reconnectStoredServers(db, rustPlus).catch((err) => {
    app.log.error(err, "Rust+ reconnect on startup failed");
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Shutting down (${signal})...`);
    try {
      await rustPlus.disconnectAll();
      await app.close();
    } catch (err) {
      app.log.error(err, "Shutdown error");
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[API] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[API] Uncaught exception:", err);
});
