import type { FastifyInstance } from "fastify";
import type { Database } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import multipart from "@fastify/multipart";
import { buildMapTransform, hasVendingSearchInput } from "@rusttools/shared";
import { requireCapability } from "../lib/auth.js";
import { parseTeamRoster, getWorldSize, getActiveServer } from "../lib/rust-data.js";
import { sendAndPublishTeamChat } from "../lib/team-chat-outbound.js";
import { applyTeamTracking } from "../lib/team-tracker.js";
import { parseMapMarkers, parseMonuments } from "../lib/map-markers.js";
import { searchVending } from "../lib/vending.js";
import { fetchWorldEventsStatus } from "../lib/world-events-status.js";
import { registerServerRoutes as registerServerCoreRoutes } from "./servers.js";
import { registerMapOverlayRoutes } from "./map-overlays.js";
import { registerProcgenMapRoutes } from "./procgen-map.js";

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

  app.get("/servers/active/map", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    try {
      const [map, info] = await Promise.all([
        deps.rustPlus.getMap(),
        deps.rustPlus.getServerInfo(),
      ]);
      const worldSize = getWorldSize(info);
      const [team, markersRaw] = await Promise.all([
        deps.rustPlus.getTeamInfo(),
        deps.rustPlus.getMapMarkers(),
      ]);
      const transform = buildMapTransform(map, info as { mapSize?: number });
      const parsed = parseTeamRoster(team, worldSize);
      const tracked = applyTeamTracking(deps.rustPlus.getStatus().activeServerId, parsed, worldSize);
      return {
        map: {
          width: map.width,
          height: map.height,
          imageBase64: map.jpgImage?.toString("base64") ?? null,
        },
        transform,
        team: tracked.team.members,
        monuments: parseMonuments(map),
        markers: parseMapMarkers(markersRaw),
      };
    } catch (err) {
      return reply.status(503).send({
        error: err instanceof Error ? err.message : "Rust+ not connected",
      });
    }
  });

  app.get("/servers/active/map/live", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    try {
      const info = await deps.rustPlus.getServerInfo();
      const worldSize = getWorldSize(info);
      const [team, markersRaw] = await Promise.all([
        deps.rustPlus.getTeamInfo(),
        deps.rustPlus.getMapMarkers(),
      ]);
      const parsed = parseTeamRoster(team, worldSize);
      const tracked = applyTeamTracking(deps.rustPlus.getStatus().activeServerId, parsed, worldSize);
      const activeServer = await getActiveServer(deps.db);
      const worldEvents = activeServer
        ? await fetchWorldEventsStatus(deps.db, deps.rustPlus, activeServer.id, worldSize).catch(
            () => null,
          )
        : null;
      return {
        team: tracked.team.members,
        markers: parseMapMarkers(markersRaw),
        worldEvents,
      };
    } catch (err) {
      return reply.status(503).send({
        error: err instanceof Error ? err.message : "Rust+ not connected",
      });
    }
  });

  app.get("/servers/active/markers", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    try {
      const markersRaw = await deps.rustPlus.getMapMarkers();
      return { markers: parseMapMarkers(markersRaw) };
    } catch (err) {
      return reply.status(503).send({
        error: err instanceof Error ? err.message : "Rust+ not connected",
      });
    }
  });

  app.get("/vending/search", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const {
      q,
      currency,
      minPrice,
      maxPrice,
      minProfitMargin,
      sort,
    } = request.query as {
      q?: string;
      currency?: string;
      minPrice?: string;
      maxPrice?: string;
      minProfitMargin?: string;
      sort?: string;
    };

    const filters = {
      currency: currency?.trim() || undefined,
      minPrice: minPrice != null && minPrice !== "" ? Number(minPrice) : undefined,
      maxPrice: maxPrice != null && maxPrice !== "" ? Number(maxPrice) : undefined,
      minProfitMargin:
        minProfitMargin != null && minProfitMargin !== ""
          ? Number(minProfitMargin)
          : undefined,
    };

    if (
      Number.isNaN(filters.minPrice) ||
      Number.isNaN(filters.maxPrice) ||
      Number.isNaN(filters.minProfitMargin)
    ) {
      return reply.status(400).send({ error: "Price and profit margin filters must be numbers" });
    }

    const sortMode =
      sort === "price" || sort === "margin" ? sort : undefined;

    if (!hasVendingSearchInput(q, filters)) {
      return reply.status(400).send({
        error: "Provide a search query (q) and/or filters (currency, minPrice, maxPrice, minProfitMargin)",
      });
    }

    try {
      const markers = await deps.rustPlus.getMapMarkers();
      return { results: searchVending(markers, q?.trim(), filters, sortMode) };
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
