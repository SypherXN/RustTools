import type { FastifyInstance } from "fastify";
import type { Database } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import multipart from "@fastify/multipart";
import { buildMapTransform } from "@rusttools/shared";
import { requireCapability } from "../lib/auth.js";
import { parseTeamRoster, resolveWorldSize, getActiveServer } from "../lib/rust-data.js";
import { sendAndPublishTeamChat } from "../lib/team-chat-outbound.js";
import { applyTeamTrackingWithSettings } from "../lib/team-tracker.js";
import { parseMonuments } from "../lib/map-markers.js";
import { registerServerRoutes as registerServerCoreRoutes } from "./servers.js";
import { registerMapOverlayRoutes } from "./map-overlays.js";
import { registerProcgenMapRoutes } from "./procgen-map.js";
import { registerTeamBoardRoutes } from "./team-board.js";

export async function registerServerRoutes(
  app: FastifyInstance,
  deps: { db: Database; rustPlus: RustPlusManager },
): Promise<void> {
  await app.register(multipart, {
    limits: { fileSize: 256 * 1024 * 1024 },
  });

  await registerServerCoreRoutes(app, deps);
  await registerMapOverlayRoutes(app, deps);
  await registerProcgenMapRoutes(app, deps);
  await registerTeamBoardRoutes(app, deps);

  app.get("/servers/active/map/image", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    try {
      const map = await deps.rustPlus.getMap();
      return {
        map: {
          width: map.width,
          height: map.height,
          imageBase64: map.jpgImage?.toString("base64") ?? null,
        },
      };
    } catch (err) {
      return reply.status(503).send({
        error: err instanceof Error ? err.message : "Rust+ not connected",
      });
    }
  });

  app.get("/servers/active/map", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const { includeImage } = request.query as { includeImage?: string };
    const wantImage = includeImage === "1" || includeImage === "true";

    try {
      const map = await deps.rustPlus.getMap();
      const worldSize = await resolveWorldSize(deps.rustPlus, deps.db);
      const team = await deps.rustPlus.getTeamInfo();
      const transform = buildMapTransform(map, { mapSize: worldSize });
      const parsed = parseTeamRoster(team, worldSize);
      const activeServerId = deps.rustPlus.getStatus().activeServerId;
      const tracked = await applyTeamTrackingWithSettings(deps.db, activeServerId, parsed, worldSize);
      return {
        map: {
          width: map.width,
          height: map.height,
          ...(wantImage ? { imageBase64: map.jpgImage?.toString("base64") ?? null } : {}),
        },
        transform,
        team: tracked.team.members,
        monuments: parseMonuments(map),
      };
    } catch (err) {
      return reply.status(503).send({
        error: err instanceof Error ? err.message : "Rust+ not connected",
      });
    }
  });

  app.post("/servers/active/chat", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    const { message } = request.body as { message?: string };
    if (!message?.trim()) {
      return reply.status(400).send({ error: "Message is required" });
    }

    try {
      const activeServer = await getActiveServer(deps.db);
      if (!activeServer) {
        return reply.status(503).send({ error: "No active server" });
      }

      const published = await sendAndPublishTeamChat(
        deps.rustPlus,
        activeServer.id,
        activeServer.playerId,
        user.discordUsername,
        message,
      );
      return { ok: true, message: published };
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : "Failed to send team message",
      });
    }
  });
}
