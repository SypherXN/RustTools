import type { FastifyInstance } from "fastify";
import { and, eq, or, like } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import {
  aggregateStorageItemSearch,
  parseStorageEntityInfo,
  STORAGE_CONTAINER_ICON_CATALOG,
} from "@rusttools/shared";
import { logAudit } from "../lib/audit.js";
import { runWithConcurrency } from "../lib/concurrency.js";
import { requireCapability } from "../lib/auth.js";
import {
  fetchSwitchStateForEntityDbId,
  fetchSwitchStatesByDbId,
  listDeviceRows,
  listStorageMonitorMetadata,
} from "../lib/device-list.js";
import { getActiveServerId } from "../lib/rust-data.js";
import { getSwitchState, recycleFromEntityInfo, resolveSwitchTargetValue } from "../lib/vending.js";

const STORAGE_ITEM_SEARCH_CONCURRENCY = 5;

export async function registerDeviceRoutes(
  app: FastifyInstance,
  deps: { db: Database; rustPlus: RustPlusManager },
): Promise<void> {
  app.get("/devices", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const serverId = await getActiveServerId(deps.db);
    const rows = await listDeviceRows(deps.db, serverId);
    return { devices: rows, activeServerId: serverId };
  });

  app.get("/devices/switch-states", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const { entityId, entityDbId } = request.query as {
      entityId?: string;
      entityDbId?: string;
    };
    const serverId = await getActiveServerId(deps.db);
    const rows = await listDeviceRows(deps.db, serverId);
    const switches = rows.filter((d) => d.entityType === "smart_switch");

    if (entityDbId) {
      const value = await fetchSwitchStateForEntityDbId(deps.db, deps.rustPlus, entityDbId);
      return { states: value == null ? {} : { [entityDbId]: value } };
    }

    if (entityId) {
      const rustId = Number(entityId);
      const match = switches.find((sw) => sw.entityId === rustId);
      if (!match) return { states: {} };
      const value = await getSwitchState(deps.rustPlus, match.entityId);
      return { states: { [match.id]: value } };
    }

    const states = await fetchSwitchStatesByDbId(deps.rustPlus, switches);
    return { states };
  });

  app.patch("/devices/:entityId", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { entityId } = request.params as { entityId: string };
    const { displayName, icon } = request.body as {
      displayName?: string;
      icon?: string | null;
    };

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
        icon: icon !== undefined ? icon : device.icon,
        updatedAt: new Date(),
      })
      .where(eq(rustEntities.id, entityId));

    await logAudit(deps.db, {
      userId: user.id,
      action: "device_rename",
      targetType: "entity",
      targetId: entityId,
      metadata: { displayName, icon },
    });

    return { ok: true };
  });

  app.get("/devices/:entityId/info", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
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
      const parsed =
        device.entityType === "storage_monitor" ? parseStorageEntityInfo(info) : null;
      return { device, info, recycle, parsed };
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : "Failed to fetch device info",
      });
    }
  });

  app.post("/devices/:entityId/toggle", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
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

    let newValue = await resolveSwitchTargetValue(deps.rustPlus, device.entityId, { action, value });

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
    const user = await requireCapability(deps.db, request, reply, "switch");
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
        const newValue = await resolveSwitchTargetValue(deps.rustPlus, sw.entityId, { action, value });
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

  app.get("/storage/container-icons", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;
    return { catalog: STORAGE_CONTAINER_ICON_CATALOG };
  });

  app.get("/storage", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const serverId = await getActiveServerId(deps.db);
    const monitors = await listStorageMonitorMetadata(deps.db, deps.rustPlus, serverId);
    return { monitors };
  });

  app.get("/storage/search", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
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

  app.get("/storage/items/search", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const { q } = request.query as { q?: string };
    if (!q?.trim()) {
      return reply.status(400).send({ error: "Query parameter q is required" });
    }

    const serverId = await getActiveServerId(deps.db);
    const monitorConditions = [eq(rustEntities.entityType, "storage_monitor")];
    if (serverId) monitorConditions.push(eq(rustEntities.serverId, serverId));

    const monitors = await deps.db
      .select()
      .from(rustEntities)
      .where(and(...monitorConditions));

    const monitorResults: Array<{
      id: string;
      name: string;
      entityId: number;
      items: ReturnType<typeof parseStorageEntityInfo>["items"];
      error: string | null;
    }> = [];

    await runWithConcurrency(monitors, STORAGE_ITEM_SEARCH_CONCURRENCY, async (monitor) => {
      try {
        const info = await deps.rustPlus.getEntityInfo(monitor.entityId);
        const parsed = parseStorageEntityInfo(info);
        monitorResults.push({
          id: monitor.id,
          name: monitor.displayName ?? monitor.name,
          entityId: monitor.entityId,
          items: parsed.items,
          error: null,
        });
      } catch (err) {
        monitorResults.push({
          id: monitor.id,
          name: monitor.displayName ?? monitor.name,
          entityId: monitor.entityId,
          items: [],
          error: err instanceof Error ? err.message : "Failed to load",
        });
      }
    });

    const matches = aggregateStorageItemSearch(monitorResults, q);
    const failed = monitorResults
      .filter((result) => result.error)
      .map((result) => ({ id: result.id, name: result.name, error: result.error! }));

    return { query: q.trim(), matches, failed };
  });
}
