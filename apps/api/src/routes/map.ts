import type { FastifyInstance } from "fastify";
import type { Database } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { requireAuth } from "../lib/auth.js";
import { parseTeamRoster } from "../lib/rust-data.js";
import { searchVending } from "../lib/vending.js";
import { registerServerRoutes as registerServerCoreRoutes } from "./servers.js";

export async function registerServerRoutes(
  app: FastifyInstance,
  deps: { db: Database; rustPlus: RustPlusManager },
): Promise<void> {
  await registerServerCoreRoutes(app, deps);

  app.get("/servers/active/map", async (request, reply) => {
    const user = await requireAuth(deps.db, request, reply);
    if (!user) return;

    try {
      const map = await deps.rustPlus.getMap();
      const team = await deps.rustPlus.getTeamInfo();
      const markers = await deps.rustPlus.getMapMarkers();
      return {
        map: {
          width: map.width,
          height: map.height,
          imageBase64: map.jpgImage?.toString("base64") ?? null,
        },
        team: parseTeamRoster(team),
        markers,
      };
    } catch (err) {
      return reply.status(503).send({
        error: err instanceof Error ? err.message : "Rust+ not connected",
      });
    }
  });

  app.get("/servers/active/markers", async (request, reply) => {
    const user = await requireAuth(deps.db, request, reply);
    if (!user) return;

    try {
      const markers = await deps.rustPlus.getMapMarkers();
      return { markers };
    } catch (err) {
      return reply.status(503).send({
        error: err instanceof Error ? err.message : "Rust+ not connected",
      });
    }
  });

  app.get("/vending/search", async (request, reply) => {
    const user = await requireAuth(deps.db, request, reply);
    if (!user) return;

    const { q } = request.query as { q?: string };
    if (!q?.trim()) {
      return reply.status(400).send({ error: "Query parameter q is required" });
    }

    try {
      const markers = await deps.rustPlus.getMapMarkers();
      return { results: searchVending(markers, q.trim()) };
    } catch (err) {
      return reply.status(503).send({
        error: err instanceof Error ? err.message : "Rust+ not connected",
      });
    }
  });

  app.post("/servers/active/chat", async (request, reply) => {
    const user = await requireAuth(deps.db, request, reply);
    if (!user) return;

    const { message } = request.body as { message?: string };
    if (!message?.trim()) {
      return reply.status(400).send({ error: "Message is required" });
    }

    try {
      await deps.rustPlus.sendTeamMessage(message.trim());
      return { ok: true };
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : "Failed to send team message",
      });
    }
  });
}
