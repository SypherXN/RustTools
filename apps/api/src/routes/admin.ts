import type { FastifyInstance } from "fastify";
import type { Database } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { getFcmCredentialStatus } from "@rusttools/rustplus-client";
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
