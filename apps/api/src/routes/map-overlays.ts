import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { mapDrawings, mapPins, rustServers } from "@rusttools/db";
import type {
  MapDrawingStroke,
  MapOverlaysResponse,
  MapPin,
} from "@rusttools/shared";
import { buildConnectString, parseServerMapMeta } from "@rusttools/shared";
import { requireCapability } from "../lib/auth.js";
import { deleteAutomationRulesReferencingMapPin } from "../lib/automation-rule-cleanup.js";
import { generateId } from "../lib/ids.js";
import { getActiveServer } from "../lib/rust-data.js";
import { deletePinScreenshotIfExists, ensureMapPinScreensDir, pinScreenshotPath } from "../lib/map-pin-storage.js";

function parseDrawingRow(row: typeof mapDrawings.$inferSelect): MapDrawingStroke {
  return {
    id: row.id,
    tool: row.tool as MapDrawingStroke["tool"],
    label: row.label ?? "",
    color: row.color,
    width: row.width,
    points: JSON.parse(row.pointsJson) as MapDrawingStroke["points"],
    createdBy: row.createdBy,
    createdAt: row.createdAt.getTime(),
  };
}

function parsePinRow(row: typeof mapPins.$inferSelect): MapPin {
  return {
    id: row.id,
    label: row.label,
    x: row.x,
    y: row.y,
    notes: row.notes,
    screenshotUrl: row.screenshotPath ? `/servers/active/map/pins/${row.id}/screenshot` : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export async function registerMapOverlayRoutes(
  app: FastifyInstance,
  deps: { db: Database },
): Promise<void> {
  ensureMapPinScreensDir();

  app.get("/servers/active/map/overlays", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const active = await getActiveServer(deps.db);
    if (!active) {
      return reply.status(503).send({ error: "No active server" });
    }

    const [drawings, pins] = await Promise.all([
      deps.db.select().from(mapDrawings).where(eq(mapDrawings.serverId, active.id)),
      deps.db.select().from(mapPins).where(eq(mapPins.serverId, active.id)),
    ]);

    const response: MapOverlaysResponse = {
      drawings: drawings.map(parseDrawingRow),
      pins: pins.map(parsePinRow),
    };
    return response;
  });

  app.post("/servers/active/map/drawings", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    const active = await getActiveServer(deps.db);
    if (!active) {
      return reply.status(503).send({ error: "No active server" });
    }

    const body = request.body as {
      tool?: MapDrawingStroke["tool"];
      label?: string;
      color?: string;
      width?: number;
      points?: MapDrawingStroke["points"];
    };

    if (!body.tool || !body.color || !body.width || !body.points?.length) {
      return reply.status(400).send({ error: "tool, color, width, and points are required" });
    }

    const label = body.label?.trim() ?? "";
    const id = generateId();
    const now = new Date();
    await deps.db.insert(mapDrawings).values({
      id,
      serverId: active.id,
      tool: body.tool,
      label,
      color: body.color,
      width: body.width,
      pointsJson: JSON.stringify(body.points),
      createdBy: user.discordUsername,
      createdAt: now,
    });

    return parseDrawingRow({
      id,
      serverId: active.id,
      tool: body.tool,
      label,
      color: body.color,
      width: body.width,
      pointsJson: JSON.stringify(body.points),
      createdBy: user.discordUsername,
      createdAt: now,
    });
  });

  app.patch("/servers/active/map/drawings/:id", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    const { id } = request.params as { id: string };
    const body = request.body as { label?: string; color?: string };

    const [existing] = await deps.db.select().from(mapDrawings).where(eq(mapDrawings.id, id)).limit(1);
    if (!existing) {
      return reply.status(404).send({ error: "Drawing not found" });
    }

    await deps.db
      .update(mapDrawings)
      .set({
        ...(body.label != null ? { label: body.label.trim() } : {}),
        ...(body.color != null ? { color: body.color } : {}),
      })
      .where(eq(mapDrawings.id, id));

    const [row] = await deps.db.select().from(mapDrawings).where(eq(mapDrawings.id, id)).limit(1);
    return parseDrawingRow(row!);
  });

  app.delete("/servers/active/map/drawings/:id", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    const { id } = request.params as { id: string };
    await deps.db.delete(mapDrawings).where(eq(mapDrawings.id, id));
    return { ok: true };
  });

  app.post("/servers/active/map/pins", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    const active = await getActiveServer(deps.db);
    if (!active) {
      return reply.status(503).send({ error: "No active server" });
    }

    const body = request.body as { label?: string; x?: number; y?: number; notes?: string };
    if (!body.label?.trim() || body.x == null || body.y == null) {
      return reply.status(400).send({ error: "label, x, and y are required" });
    }

    const id = generateId();
    const now = new Date();
    await deps.db.insert(mapPins).values({
      id,
      serverId: active.id,
      label: body.label.trim(),
      x: body.x,
      y: body.y,
      notes: body.notes?.trim() ?? "",
      createdBy: user.discordUsername,
      createdAt: now,
      updatedAt: now,
    });

    const [row] = await deps.db.select().from(mapPins).where(eq(mapPins.id, id)).limit(1);
    return parsePinRow(row!);
  });

  app.patch("/servers/active/map/pins/:id", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    const { id } = request.params as { id: string };
    const body = request.body as { label?: string; notes?: string };

    const now = new Date();
    await deps.db
      .update(mapPins)
      .set({
        ...(body.label != null ? { label: body.label.trim() } : {}),
        ...(body.notes != null ? { notes: body.notes.trim() } : {}),
        updatedAt: now,
      })
      .where(eq(mapPins.id, id));

    const [row] = await deps.db.select().from(mapPins).where(eq(mapPins.id, id)).limit(1);
    if (!row) return reply.status(404).send({ error: "Pin not found" });
    return parsePinRow(row);
  });

  app.delete("/servers/active/map/pins/:id", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    const { id } = request.params as { id: string };
    const [row] = await deps.db.select().from(mapPins).where(eq(mapPins.id, id)).limit(1);
    if (row?.screenshotPath) {
      deletePinScreenshotIfExists(row.screenshotPath);
    } else if (row) {
      deletePinScreenshotIfExists(id);
    }
    if (row) {
      await deleteAutomationRulesReferencingMapPin(deps.db, row.serverId, id);
    }
    await deps.db.delete(mapPins).where(eq(mapPins.id, id));
    return { ok: true };
  });

  app.post("/servers/active/map/pins/:id/screenshot", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    const { id } = request.params as { id: string };
    const [row] = await deps.db.select().from(mapPins).where(eq(mapPins.id, id)).limit(1);
    if (!row) return reply.status(404).send({ error: "Pin not found" });

    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ error: "Expected screenshot file" });
    }

    const buffer = await file.toBuffer();
    if (buffer.length > 5 * 1024 * 1024) {
      return reply.status(400).send({ error: "Screenshot must be under 5 MB" });
    }

    ensureMapPinScreensDir();
    const dest = pinScreenshotPath(id);
    if (row.screenshotPath) {
      deletePinScreenshotIfExists(row.screenshotPath);
    }
    fs.writeFileSync(dest, buffer);

    const now = new Date();
    await deps.db
      .update(mapPins)
      .set({ screenshotPath: dest, updatedAt: now })
      .where(eq(mapPins.id, id));

    return { ok: true, screenshotUrl: `/servers/active/map/pins/${id}/screenshot` };
  });

  app.get("/servers/active/map/pins/:id/screenshot", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const { id } = request.params as { id: string };
    const [row] = await deps.db.select().from(mapPins).where(eq(mapPins.id, id)).limit(1);
    if (!row?.screenshotPath || !fs.existsSync(row.screenshotPath)) {
      return reply.status(404).send({ error: "Screenshot not found" });
    }

    const data = fs.readFileSync(row.screenshotPath);
    return reply.type("image/jpeg").send(data);
  });
}

export async function buildActiveServerConnectInfo(
  db: Database,
  info: unknown,
): Promise<{
  mapMeta: ReturnType<typeof parseServerMapMeta>;
  connectString: string | null;
}> {
  const active = await getActiveServer(db);
  if (!active) {
    return { mapMeta: parseServerMapMeta(info), connectString: null };
  }

  const [server] = await db
    .select({ ip: rustServers.ip, port: rustServers.port })
    .from(rustServers)
    .where(eq(rustServers.id, active.id))
    .limit(1);

  const mapMeta = parseServerMapMeta(info);
  const data = info as { password?: string };
  const connectString = server
    ? buildConnectString({
        ip: server.ip,
        port: server.port,
        password: data.password ?? null,
      })
    : null;

  return { mapMeta, connectString };
}
