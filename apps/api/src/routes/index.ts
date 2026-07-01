import type { FastifyInstance } from "fastify";
import type { Database } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { registerAuthRoutes } from "./auth.js";
import { registerAuditRoutes } from "./audit.js";
import { registerDeviceRoutes } from "./devices.js";
import { registerAutomationRoutes } from "./automation.js";
import { registerServerRoutes } from "./map.js";
import { registerInternalRoutes } from "./internal.js";
import { registerAdminRoutes } from "./admin.js";
import { registerPushRoutes } from "./push.js";
import { getActiveFcmCredentialStatus } from "../lib/fcm-credentials.js";

export async function registerRoutes(
  app: FastifyInstance,
  deps: { db: Database; rustPlus: RustPlusManager },
): Promise<void> {
  app.get("/health", { config: { rateLimit: false } }, async () => {
    const rustStatus = deps.rustPlus.getStatus();
    const fcmStatus = await getActiveFcmCredentialStatus(deps.db, deps.rustPlus);
    return {
      status: "ok",
      version: "0.1.0",
      uptime: process.uptime(),
      rustplus: {
        connected: rustStatus.connected,
        reconnectPending: rustStatus.reconnectPending,
        activeServerId: rustStatus.activeServerId,
      },
      fcm: {
        listening: fcmStatus.listening,
        configured: fcmStatus.configured,
        daysRemaining: fcmStatus.daysRemaining,
        warning: fcmStatus.warning,
        expired: fcmStatus.expired,
        expiresAt: fcmStatus.expiresAt,
      },
    };
  });

  await registerAuthRoutes(app, deps.db);
  await registerServerRoutes(app, deps);
  await registerDeviceRoutes(app, deps);
  await registerAutomationRoutes(app, deps);
  await registerAuditRoutes(app, deps.db);
  await registerAdminRoutes(app, deps);
  await registerPushRoutes(app, deps.db);
  await registerInternalRoutes(app, deps);
}
