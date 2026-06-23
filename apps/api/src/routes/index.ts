import type { FastifyInstance } from "fastify";
import type { Database } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { registerAuthRoutes } from "./auth.js";
import { registerAuditRoutes } from "./audit.js";
import { registerDeviceRoutes } from "./devices.js";
import { registerServerRoutes } from "./map.js";
import { registerInternalRoutes } from "./internal.js";

export async function registerRoutes(
  app: FastifyInstance,
  deps: { db: Database; rustPlus: RustPlusManager },
): Promise<void> {
  app.get("/health", async () => {
    const rustStatus = deps.rustPlus.getStatus();
    return {
      status: "ok",
      version: "0.1.0",
      uptime: process.uptime(),
      rustplus: {
        connected: rustStatus.connected,
        activeServerId: rustStatus.activeServerId,
      },
      fcm: {
        listening: rustStatus.fcmListening,
      },
    };
  });

  await registerAuthRoutes(app, deps.db);
  await registerServerRoutes(app, deps);
  await registerDeviceRoutes(app, deps);
  await registerAuditRoutes(app, deps.db);
  await registerInternalRoutes(app, deps);
}
