import type { FastifyInstance } from "fastify";
import { and, eq, or, like } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { logAudit } from "../lib/audit.js";
import { requireAuth } from "../lib/auth.js";
import { getActiveServerId } from "../lib/rust-data.js";
import { getSwitchState, recycleFromEntityInfo } from "../lib/vending.js";

export async function registerDeviceRoutes(
  app: FastifyInstance,
  deps: { db: Database; rustPlus: RustPlusManager },
): Promise<void> {
  app.get("/devices", async (request, reply) => {
    const user = await requireAuth(deps.db, request, reply);
    if (!user) return;

    const serverId = await getActiveServerId(deps.db);
    const devices = serverId
      ? await deps.db.select().from(rustEntities).where(eq(rustEntities.serverId, serverId))
      : await deps.db.select().from(rustEntities);

    return { devices, activeServerId: serverId };
  });

  app.patch("/devices/:entityId", async (request, reply) => {
    const user = await requireAuth(deps.db, request, reply);
    if (!user) return;

    const { entityId } = request.params as { entityId: string };
    const { displayName, icon } = request.body as { displayName?: string; icon?: string };

    const [device] = await deps.db
      .select()
      .from(rustEntities)
      .where(eq(rustEntities.id, entityId))
      .limit(1);

    if (!device) {
      return reply.status(404).send({ error: "Device not found" });
    }

    await deps.db
      .update(rustEntities)
      .set({
        displayName: displayName ?? device.displayName,
        icon: icon ?? device.icon,
        updatedAt: new Date(),
      })
      .where(eq(rustEntities.id, entityId));

    await logAudit(deps.db, {
      userId: user.id,
      action: "device_rename",
      targetType: "entity",
      targetId: entityId,
      metadata: { displayName },
    });

    return { ok: true };
  });

  app.get("/devices/:entityId/info", async (request, reply) => {
    const user = await requireAuth(deps.db, request, reply);
    if (!user) return;

    const { entityId } = request.params as { entityId: string };
    const [device] = await deps.db
      .select()
      .from(rustEntities)
      .where(eq(rustEntities.id, entityId))
      .limit(1);

    if (!device) {
      return reply.status(404).send({ error: "Device not found" });
    }

    try {
      const info = await deps.rustPlus.getEntityInfo(device.entityId);
      const recycle =
        device.entityType === "storage_monitor" ? recycleFromEntityInfo(info) : null;
      return { device, info, recycle };
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : "Failed to fetch device info",
      });
    }
  });

  app.post("/devices/:entityId/toggle", async (request, reply) => {
    const user = await requireAuth(deps.db, request, reply);
    if (!user) return;

    const { entityId } = request.params as { entityId: string };
    const { value, action } = request.body as { value?: boolean; action?: "on" | "off" | "toggle" };

    const [device] = await deps.db
      .select()
      .from(rustEntities)
      .where(eq(rustEntities.id, entityId))
      .limit(1);

    if (!device) {
      return reply.status(404).send({ error: "Device not found" });
    }

    if (device.entityType !== "smart_switch") {
      return reply.status(400).send({ error: "Only smart switches can be toggled" });
    }

    let newValue = value;
    if (action === "toggle" || newValue === undefined) {
      const current = await getSwitchState(deps.rustPlus, device.entityId);
      newValue = current === null ? true : !current;
    }

    try {
      await deps.rustPlus.toggleSwitch(device.entityId, newValue);
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : "Failed to toggle switch",
      });
    }

    await logAudit(deps.db, {
      userId: user.id,
      action: "switch_toggle",
      targetType: "entity",
      targetId: device.id,
      metadata: { value: newValue },
    });

    return { ok: true, value: newValue };
  });

  app.post("/devices/switch-group", async (request, reply) => {
    const user = await requireAuth(deps.db, request, reply);
    if (!user) return;

    const { name, value, action } = request.body as {
      name: string;
      value?: boolean;
      action?: "on" | "off" | "toggle";
    };
    if (!name) {
      return reply.status(400).send({ error: "Switch group name is required" });
    }

    const serverId = await getActiveServerId(deps.db);
    const switchConditions = [
      eq(rustEntities.entityType, "smart_switch"),
      or(eq(rustEntities.name, name), eq(rustEntities.displayName, name)),
    ];
    if (serverId) switchConditions.push(eq(rustEntities.serverId, serverId));

    const switches = await deps.db
      .select()
      .from(rustEntities)
      .where(and(...switchConditions));

    let toggled = 0;
    for (const sw of switches) {
      try {
        let newValue = value;
        if (action === "toggle" || newValue === undefined) {
          const current = await getSwitchState(deps.rustPlus, sw.entityId);
          newValue = current === null ? true : !current;
        }
        await deps.rustPlus.toggleSwitch(sw.entityId, newValue);
        toggled += 1;
      } catch {
        // continue
      }
    }

    await logAudit(deps.db, {
      userId: user.id,
      action: "switch_group_toggle",
      targetType: "group",
      targetId: name,
      metadata: { toggled, action, value },
    });

    return { ok: true, toggled };
  });

  app.get("/storage", async (request, reply) => {
    const user = await requireAuth(deps.db, request, reply);
    if (!user) return;

    const serverId = await getActiveServerId(deps.db);
    const monitorConditions = [eq(rustEntities.entityType, "storage_monitor")];
    if (serverId) monitorConditions.push(eq(rustEntities.serverId, serverId));

    const monitors = await deps.db
      .select()
      .from(rustEntities)
      .where(and(...monitorConditions));

    return { monitors };
  });

  app.get("/storage/search", async (request, reply) => {
    const user = await requireAuth(deps.db, request, reply);
    if (!user) return;

    const { q } = request.query as { q?: string };
    if (!q) {
      return reply.status(400).send({ error: "Query parameter q is required" });
    }

    const serverId = await getActiveServerId(deps.db);
    const searchConditions = [
      eq(rustEntities.entityType, "storage_monitor"),
      or(like(rustEntities.name, `%${q}%`), like(rustEntities.displayName, `%${q}%`)),
    ];
    if (serverId) searchConditions.push(eq(rustEntities.serverId, serverId));

    const monitors = await deps.db
      .select()
      .from(rustEntities)
      .where(and(...searchConditions));

    return { monitors };
  });
}
