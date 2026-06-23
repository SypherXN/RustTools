import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, or } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { logAudit } from "../lib/audit.js";
import {
  assertInternalApiKey,
  requireDiscordCapability,
} from "../lib/discord-permissions.js";
import { getActiveServerId } from "../lib/rust-data.js";
import { getSwitchState } from "../lib/vending.js";

function discordIdFrom(request: FastifyRequest): string | undefined {
  const query = request.query as Record<string, string>;
  const body = request.body as Record<string, unknown> | undefined;
  return query.discordUserId ?? (body?.discordUserId as string | undefined);
}

export async function registerInternalRoutes(
  app: FastifyInstance,
  deps: { db: Database; rustPlus: RustPlusManager },
): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/internal/")) return;
    if (!assertInternalApiKey(request.headers.authorization)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/internal/health", async (request, reply) => {
    const discordUserId = discordIdFrom(request);
    const perm = await requireDiscordCapability(discordUserId, "view");
    if (!perm.ok) return reply.status(403).send({ error: perm.error });

    const status = deps.rustPlus.getStatus();
    return {
      status: "ok",
      rustplus: {
        connected: status.connected,
        fcmListening: status.fcmListening,
        activeServerId: status.activeServerId,
      },
    };
  });

  app.get("/internal/team", async (request, reply) => {
    const discordUserId = discordIdFrom(request);
    const perm = await requireDiscordCapability(discordUserId, "view");
    if (!perm.ok) return reply.status(403).send({ error: perm.error });

    const team = await deps.rustPlus.getTeamInfo();
    return { team };
  });

  app.get("/internal/time", async (request, reply) => {
    const discordUserId = discordIdFrom(request);
    const perm = await requireDiscordCapability(discordUserId, "view");
    if (!perm.ok) return reply.status(403).send({ error: perm.error });

    const time = await deps.rustPlus.getTime();
    return { time };
  });

  app.get("/internal/devices", async (request, reply) => {
    const discordUserId = discordIdFrom(request);
    const perm = await requireDiscordCapability(discordUserId, "view");
    if (!perm.ok) return reply.status(403).send({ error: perm.error });

    const serverId = await getActiveServerId(deps.db);
    const devices = serverId
      ? await deps.db.select().from(rustEntities).where(eq(rustEntities.serverId, serverId))
      : await deps.db.select().from(rustEntities);
    return { devices };
  });

  app.post("/internal/switch", async (request, reply) => {
    const { discordUserId, target, action } = request.body as {
      discordUserId: string;
      target: string;
      action?: "on" | "off" | "toggle";
    };

    const perm = await requireDiscordCapability(discordUserId, "switch");
    if (!perm.ok) return reply.status(403).send({ error: perm.error });

    const numericId = Number(target);
    const [device] = await deps.db
      .select()
      .from(rustEntities)
      .where(
        and(
          eq(rustEntities.entityType, "smart_switch"),
          Number.isNaN(numericId)
            ? or(eq(rustEntities.name, target), eq(rustEntities.displayName, target))
            : eq(rustEntities.entityId, numericId),
        ),
      )
      .limit(1);

    if (!device) {
      return reply.status(404).send({ error: "Switch not found" });
    }

    let value: boolean;
    if (action === "off") value = false;
    else if (action === "on") value = true;
    else {
      const current = await getSwitchState(deps.rustPlus, device.entityId);
      value = current === null ? true : !current;
    }

    await deps.rustPlus.toggleSwitch(device.entityId, value);

    await logAudit(deps.db, {
      action: "discord_switch_toggle",
      targetType: "entity",
      targetId: device.id,
      metadata: { discordUserId, value, action },
    });

    return { ok: true, device: device.displayName ?? device.name, value };
  });

  app.get("/internal/storage/:target", async (request, reply) => {
    const discordUserId = discordIdFrom(request);
    const perm = await requireDiscordCapability(discordUserId, "view");
    if (!perm.ok) return reply.status(403).send({ error: perm.error });

    const { target } = request.params as { target: string };
    const numericId = Number(target);
    const [device] = await deps.db
      .select()
      .from(rustEntities)
      .where(
        and(
          eq(rustEntities.entityType, "storage_monitor"),
          Number.isNaN(numericId)
            ? or(eq(rustEntities.name, target), eq(rustEntities.displayName, target))
            : eq(rustEntities.entityId, numericId),
        ),
      )
      .limit(1);

    if (!device) {
      return reply.status(404).send({ error: "Storage monitor not found" });
    }

    const info = await deps.rustPlus.getEntityInfo(device.entityId);
    return { device, info };
  });

  app.post("/internal/chat", async (request, reply) => {
    const { discordUserId, message } = request.body as {
      discordUserId: string;
      message: string;
    };

    const perm = await requireDiscordCapability(discordUserId, "switch");
    if (!perm.ok) return reply.status(403).send({ error: perm.error });

    await deps.rustPlus.sendTeamMessage(message);
    await logAudit(deps.db, {
      action: "discord_team_chat",
      metadata: { discordUserId, message },
    });
    return { ok: true };
  });

  app.get("/internal/map", async (request, reply) => {
    const discordUserId = discordIdFrom(request);
    const perm = await requireDiscordCapability(discordUserId, "view");
    if (!perm.ok) return reply.status(403).send({ error: perm.error });

    const map = await deps.rustPlus.getMap();
    return {
      imageBase64: map.jpgImage?.toString("base64") ?? null,
      width: map.width,
      height: map.height,
    };
  });
}
