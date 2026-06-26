import type { FastifyInstance } from "fastify";
import type { Database } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import {
  getFcmCredentialStatus,
  validateFcmConfigPayload,
  writeFcmConfigFile,
} from "@rusttools/rustplus-client";
import { DATA_RESET_SCOPES, isDataResetScope } from "@rusttools/shared";
import { env } from "../config.js";
import { logAudit } from "../lib/audit.js";
import { requireCapability } from "../lib/auth.js";
import { executeDataReset } from "../lib/data-reset.js";

export async function registerAdminRoutes(
  app: FastifyInstance,
  deps: { db: Database; rustPlus: RustPlusManager },
): Promise<void> {
  app.get("/admin/fcm-status", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const rustStatus = deps.rustPlus.getStatus();
    return getFcmCredentialStatus(env.rustplus.resolvedFcmConfigPath, rustStatus.fcmListening);
  });

  app.post("/admin/fcm-config/upload", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const file = await request.file();
    if (!file) return reply.status(400).send({ error: "Missing fcm-config.json upload" });

    let parsed: unknown;
    try {
      const text = (await file.toBuffer()).toString("utf8");
      parsed = JSON.parse(text);
    } catch {
      return reply.status(400).send({ error: "Invalid JSON file" });
    }

    const validated = validateFcmConfigPayload(parsed);
    if (!validated.ok) {
      return reply.status(400).send({ error: validated.error });
    }

    const configPath = env.rustplus.resolvedFcmConfigPath;
    try {
      writeFcmConfigFile(configPath, validated.config);
      await deps.rustPlus.reloadFcmListener();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start FCM listener";
      return reply.status(400).send({ error: message });
    }

    await logAudit(deps.db, {
      userId: user.id,
      action: "fcm_config_upload",
      targetType: "fcm_config",
      targetId: configPath,
    });

    const rustStatus = deps.rustPlus.getStatus();
    return {
      ok: true,
      status: getFcmCredentialStatus(configPath, rustStatus.fcmListening),
    };
  });

  app.get("/admin/data-reset/scopes", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;
    return { scopes: DATA_RESET_SCOPES };
  });

  app.post("/admin/data-reset", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { scope } = request.body as { scope?: string };
    if (!scope || !isDataResetScope(scope)) {
      return reply.status(400).send({ error: "Invalid reset scope" });
    }

    const result = await executeDataReset(deps.db, deps.rustPlus, scope);

    await logAudit(deps.db, {
      userId: user.id,
      action: "data_reset",
      targetType: "reset_scope",
      targetId: scope,
      metadata: { detail: result.detail },
    });

    return { ok: true, ...result };
  });
}
