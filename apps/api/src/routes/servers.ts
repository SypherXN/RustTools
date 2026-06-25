import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustServers } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { parseTeamChatMessages } from "@rusttools/shared";
import { logAudit } from "../lib/audit.js";
import { requireCapability } from "../lib/auth.js";
import { decrypt } from "../lib/crypto.js";
import { parseInGameTime, parseTeamRoster, parseWipeCountdown, getWorldSize, getActiveServer } from "../lib/rust-data.js";
import { applyTeamTracking, enrichTeamApiResponse } from "../lib/team-tracker.js";
import { persistTeamRosterEvents, listTeamConnectionHistory, listTeamDeathHistory } from "../lib/team-event-store.js";
import { mergeTeamChatHistory } from "../lib/team-chat-buffer.js";
import {
  getActiveNotificationSettings,
  notificationCapabilities,
  updateActiveNotificationSettings,
} from "../lib/server-notification-settings.js";
import { fetchDeepSeaStatus } from "../lib/deep-sea.js";
import type { ServerNotificationSettings } from "@rusttools/shared";

export async function registerServerRoutes(
  app: FastifyInstance,
  deps: { db: Database; rustPlus: RustPlusManager },
): Promise<void> {
  app.get("/servers", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
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
    const user = await requireCapability(deps.db, request, reply, "view");
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
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    try {
      const [team, info, activeServer] = await Promise.all([
        deps.rustPlus.getTeamInfo(),
        deps.rustPlus.getServerInfo(),
        getActiveServer(deps.db),
      ]);
      const worldSize = getWorldSize(info);
      const parsed = parseTeamRoster(team, worldSize);
      const tracked = applyTeamTracking(activeServer?.id ?? null, parsed, worldSize);
      if (activeServer?.id) {
        await persistTeamRosterEvents(
          deps.db,
          activeServer.id,
          tracked.newDeaths,
          tracked.newConnections,
        );
      }
      return enrichTeamApiResponse(activeServer?.playerId ?? null, tracked.team, tracked.deaths);
    } catch (err) {
      return reply.status(503).send({
        error: err instanceof Error ? err.message : "Rust+ not connected",
      });
    }
  });

  app.get("/servers/active/team/chat", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    try {
      const activeServer = await getActiveServer(deps.db);
      if (!activeServer) {
        return reply.status(503).send({ error: "No active server" });
      }

      const raw = await deps.rustPlus.getTeamChat();
      const messages = mergeTeamChatHistory(activeServer.id, parseTeamChatMessages(raw));
      return { messages };
    } catch (err) {
      return reply.status(503).send({
        error: err instanceof Error ? err.message : "Rust+ not connected",
      });
    }
  });

  app.post("/servers/active/team/promote", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { steamId } = request.body as { steamId?: string };
    if (!steamId?.trim()) {
      return reply.status(400).send({ error: "steamId is required" });
    }

    try {
      const [team, info, activeServer] = await Promise.all([
        deps.rustPlus.getTeamInfo(),
        deps.rustPlus.getServerInfo(),
        getActiveServer(deps.db),
      ]);

      if (!activeServer) {
        return reply.status(503).send({ error: "No active server configured" });
      }

      const worldSize = getWorldSize(info);
      const parsed = parseTeamRoster(team, worldSize);

      if (!parsed.leaderSteamId || parsed.leaderSteamId !== activeServer.playerId) {
        return reply.status(403).send({
          error:
            "Only the in-game team leader can promote, and RustTools must be paired with that leader's Rust+ account.",
        });
      }

      const target = parsed.members.find((m) => m.steamId === steamId.trim());
      if (!target) {
        return reply.status(404).send({ error: "Player is not on your team" });
      }
      if (target.isLeader) {
        return reply.status(400).send({ error: "Player is already team leader" });
      }

      await deps.rustPlus.promoteToLeader(target.steamId);

      const refreshed = parseTeamRoster(await deps.rustPlus.getTeamInfo(), worldSize);
      const tracked = applyTeamTracking(activeServer.id, refreshed, worldSize);
      await persistTeamRosterEvents(
        deps.db,
        activeServer.id,
        tracked.newDeaths,
        tracked.newConnections,
      );

      await logAudit(deps.db, {
        userId: user.id,
        action: "team_promote_leader",
        targetType: "player",
        targetId: target.steamId,
        metadata: { name: target.name },
      });

      return enrichTeamApiResponse(activeServer.playerId, tracked.team, tracked.deaths);
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : "Failed to promote team leader",
      });
    }
  });

  app.get("/servers/active/team/deaths", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const activeServer = await getActiveServer(deps.db);
    if (!activeServer) {
      return reply.status(503).send({ error: "No active server configured" });
    }

    const query = request.query as { limit?: string; offset?: string };
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
    const offset = Math.max(Number(query.offset) || 0, 0);

    const deaths = await listTeamDeathHistory(deps.db, activeServer.id, limit, offset);
    return { deaths };
  });

  app.get("/servers/active/team/connections", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const activeServer = await getActiveServer(deps.db);
    if (!activeServer) {
      return reply.status(503).send({ error: "No active server configured" });
    }

    const query = request.query as { limit?: string; offset?: string };
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);

    const connections = await listTeamConnectionHistory(deps.db, activeServer.id, limit, offset);
    return { connections };
  });

  app.get("/servers/active/time", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
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

  app.get("/servers/active/deepsea", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const activeServer = await getActiveServer(deps.db);
    if (!activeServer) {
      return reply.status(404).send({ error: "No active server" });
    }

    try {
      const status = await fetchDeepSeaStatus(deps.db, deps.rustPlus, activeServer.id);
      return { status };
    } catch (err) {
      return reply.status(503).send({
        error: err instanceof Error ? err.message : "Rust+ not connected",
      });
    }
  });

  app.get("/servers/active/notifications", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const data = await getActiveNotificationSettings(deps.db, deps.rustPlus);
    if (!data) {
      return reply.status(404).send({ error: "No active server" });
    }
    return data;
  });

  app.patch("/servers/active/notifications", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const body = request.body as {
      smartAlarm?: Partial<ServerNotificationSettings["smartAlarm"]>;
      deepSea?: Partial<ServerNotificationSettings["deepSea"]>;
    };

    const settings = await updateActiveNotificationSettings(deps.db, body);
    if (!settings) {
      return reply.status(404).send({ error: "No active server" });
    }

    await logAudit(deps.db, {
      userId: user.id,
      action: "notifications_update",
      targetType: "server",
      metadata: body,
    });

    return {
      settings,
      capabilities: await notificationCapabilities(deps.db, deps.rustPlus),
    };
  });

  app.post("/servers/:id/activate", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
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
