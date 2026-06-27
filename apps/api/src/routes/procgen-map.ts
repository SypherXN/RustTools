import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { ProcgenOverlayId } from "../lib/procgen/types.js";
import type { Database } from "@rusttools/db";
import { rustServers } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { requireCapability } from "../lib/auth.js";
import { getActiveServer } from "../lib/rust-data.js";
import {
  deleteProcgenMap,
  getProcgenMapStatus,
  parseAndCacheProcgenMap,
  readProcgenJson,
  readProcgenOverlay,
} from "../lib/procgen-map.js";

const OVERLAY_IDS = new Set<ProcgenOverlayId>([
  "building-blocked",
  "heatmap-ores",
  "heatmap-stones",
  "heatmap-sulfur",
]);

function parseSeedFromFilename(filename: string): number | null {
  const match = filename.match(/\.(\d+)\.(\d+)\.map$/i) ?? filename.match(/\.(\d+)\.map$/i);
  if (!match) return null;
  const seed = Number(match[match.length - 1]);
  return Number.isFinite(seed) ? seed : null;
}

export async function registerProcgenMapRoutes(
  app: FastifyInstance,
  deps: { db: Database; rustPlus: RustPlusManager },
): Promise<void> {
  app.get("/servers/active/map/procgen/status", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const active = await getActiveServer(deps.db);
    if (!active) return reply.status(404).send({ error: "No active server" });

    let serverInfo: Record<string, unknown> | null = null;
    try {
      serverInfo = (await deps.rustPlus.getServerInfo()) as Record<string, unknown>;
    } catch {
      /* optional */
    }

    return getProcgenMapStatus(deps.db, active.id, serverInfo);
  });

  app.post("/servers/active/map/procgen/upload", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const active = await getActiveServer(deps.db);
    if (!active) return reply.status(404).send({ error: "No active server" });

    const file = await request.file();
    if (!file) return reply.status(400).send({ error: "Missing .map file upload" });

    const buffer = await file.toBuffer();
    if (buffer.byteLength < 32) {
      return reply.status(400).send({ error: "File is too small to be a valid .map file" });
    }

    const seedFromName = parseSeedFromFilename(file.filename ?? "");

    try {
      await parseAndCacheProcgenMap(deps.db, active.id, buffer);
      if (seedFromName != null) {
        await deps.db
          .update(rustServers)
          .set({ mapSeed: seedFromName, updatedAt: new Date() })
          .where(eq(rustServers.id, active.id));
      }
      return { ok: true };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : "Failed to parse .map file",
      });
    }
  });

  app.delete("/servers/active/map/procgen", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const active = await getActiveServer(deps.db);
    if (!active) return reply.status(404).send({ error: "No active server" });

    await deleteProcgenMap(deps.db, active.id);
    return { ok: true };
  });

  app.get("/servers/active/map/procgen/overlays/:overlayId", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const active = await getActiveServer(deps.db);
    if (!active) return reply.status(404).send({ error: "No active server" });

    const { overlayId } = request.params as { overlayId: string };
    if (!OVERLAY_IDS.has(overlayId as ProcgenOverlayId)) {
      return reply.status(404).send({ error: "Unknown overlay" });
    }

    const png = await readProcgenOverlay(active.id, overlayId as ProcgenOverlayId);
    if (!png) return reply.status(404).send({ error: "Overlay not available — upload a .map file first" });

    reply.header("Content-Type", "image/png");
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.send(png);
  });

  app.get("/servers/active/map/procgen/paths", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const active = await getActiveServer(deps.db);
    if (!active) return reply.status(404).send({ error: "No active server" });

    const paths = await readProcgenJson(active.id, "paths");
    return { paths: paths ?? [] };
  });

  app.get("/servers/active/map/procgen/prefabs", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const active = await getActiveServer(deps.db);
    if (!active) return reply.status(404).send({ error: "No active server" });

    const prefabs = await readProcgenJson(active.id, "prefabs");
    return { prefabs: prefabs ?? [] };
  });

  app.get("/servers/active/map/procgen/height", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const active = await getActiveServer(deps.db);
    if (!active) return reply.status(404).send({ error: "No active server" });

    const height = await readProcgenJson(active.id, "height");
    if (!height) return reply.status(404).send({ error: "Height data not available" });
    return height;
  });
}
