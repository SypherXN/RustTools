import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustServers } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { logAudit } from "../lib/audit.js";
import { requireAuth } from "../lib/auth.js";
import { decrypt } from "../lib/crypto.js";
import { parseInGameTime, parseTeamRoster, parseWipeCountdown } from "../lib/rust-data.js";

export async function registerServerRoutes(
  app: FastifyInstance,
  deps: { db: Database; rustPlus: RustPlusManager },
): Promise<void> {
  app.get("/servers", async (request, reply) => {
    const user = await requireAuth(deps.db, request, reply);
    if (!user) return;

    const servers = await deps.db
      .select({
        id: rustServers.id,
        name: rustServers.name,
        ip: rustServers.ip,
        port: rustServers.port,
        isActive: rustServers.isActive,
        createdAt: rustServers.createdAt,
      })
      .from(rustServers)
      .orderBy(desc(rustServers.createdAt));

    return { servers };
  });

  app.get("/servers/active/info", async (request, reply) => {
    const user = await requireAuth(deps.db, request, reply);
    if (!user) return;

    try {
      const info = await deps.rustPlus.getServerInfo();
      return { info, wipe: parseWipeCountdown(info) };
    } catch (err) {
      return reply.status(503).send({
        error: err instanceof Error ? err.message : "Rust+ not connected",
      });
    }
  });

  app.get("/servers/active/team", async (request, reply) => {
    const user = await requireAuth(deps.db, request, reply);
    if (!user) return;

    try {
      const team = await deps.rustPlus.getTeamInfo();
      return { team: parseTeamRoster(team) };
    } catch (err) {
      return reply.status(503).send({
        error: err instanceof Error ? err.message : "Rust+ not connected",
      });
    }
  });

  app.get("/servers/active/time", async (request, reply) => {
    const user = await requireAuth(deps.db, request, reply);
    if (!user) return;

    try {
      const time = await deps.rustPlus.getTime();
      return { time: parseInGameTime(time) };
    } catch (err) {
      return reply.status(503).send({
        error: err instanceof Error ? err.message : "Rust+ not connected",
      });
    }
  });

  app.post("/servers/:id/activate", async (request, reply) => {
    const user = await requireAuth(deps.db, request, reply);
    if (!user) return;

    const { id } = request.params as { id: string };
    const [server] = await deps.db
      .select()
      .from(rustServers)
      .where(eq(rustServers.id, id))
      .limit(1);

    if (!server) {
      return reply.status(404).send({ error: "Server not found" });
    }

    await deps.db.update(rustServers).set({ isActive: false });
    await deps.db.update(rustServers).set({ isActive: true }).where(eq(rustServers.id, id));

    try {
      await deps.rustPlus.connectServer({
        id: server.id,
        ip: server.ip,
        port: server.port,
        playerId: server.playerId,
        playerToken: decrypt(server.playerTokenEncrypted),
        name: server.name,
      });
      deps.rustPlus.setActiveServer(server.id);
      await logAudit(deps.db, {
        userId: user.id,
        action: "server_activate",
        targetType: "server",
        targetId: id,
      });
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : "Failed to connect to Rust+ server",
      });
    }

    return { ok: true, activeServerId: id };
  });
}
