import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, or } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities, users } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { logAudit } from "../lib/audit.js";
import {
  assertInternalApiKey,
  requireDiscordBotAccess,
} from "../lib/discord-permissions.js";
import {
  addDiscordBlacklistEntry,
  listDiscordBlacklist,
  removeDiscordBlacklistEntry,
} from "../lib/discord-blacklist.js";
import {
  assertGuildAllowed,
  bindDiscordChannel,
  clearDiscordChannelBinding,
  listDiscordChannelBindings,
} from "../lib/discord-channels.js";
import { fetchDeepSeaStatus } from "../lib/deep-sea.js";
import { resolveDiscordChannelId } from "../lib/discord-channels.js";
import { getActiveServer, getActiveServerId, getWorldSize, parseTeamRoster } from "../lib/rust-data.js";
import { getSwitchState } from "../lib/vending.js";
import { executeTeamChatCommand } from "../lib/team-chat-command-handler.js";
import { sendAndPublishTeamChat } from "../lib/team-chat-outbound.js";
import { isDiscordChannelPurpose } from "@rusttools/shared";
import {
  clearInformationEmbedBinding,
  ensureInformationEmbed,
} from "../lib/information-embed.js";

function discordIdFrom(request: FastifyRequest): string | undefined {
  const query = request.query as Record<string, string>;
  const body = request.body as Record<string, unknown> | undefined;
  return query.discordUserId ?? (body?.discordUserId as string | undefined);
}

async function requireInternalBotAccess(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  capability: "admin" | "switch" | "view",
  guildId?: string | null,
): Promise<string | null> {
  const discordUserId = discordIdFrom(request);
  const perm = await requireDiscordBotAccess(db, discordUserId, capability, guildId);
  if (!perm.ok) {
    reply.status(403).send({ error: perm.error });
    return null;
  }
  return discordUserId ?? null;
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
    if (!(await requireInternalBotAccess(deps.db, request, reply, "view"))) return;

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
    if (!(await requireInternalBotAccess(deps.db, request, reply, "view"))) return;

    const [teamRaw, info] = await Promise.all([
      deps.rustPlus.getTeamInfo(),
      deps.rustPlus.getServerInfo(),
    ]);
    const worldSize = getWorldSize(info);
    return { team: parseTeamRoster(teamRaw, worldSize), worldSize };
  });

  app.get("/internal/time", async (request, reply) => {
    if (!(await requireInternalBotAccess(deps.db, request, reply, "view"))) return;

    const time = await deps.rustPlus.getTime();
    return { time };
  });

  app.get("/internal/deepsea", async (request, reply) => {
    if (!(await requireInternalBotAccess(deps.db, request, reply, "view"))) return;

    const serverId = await getActiveServerId(deps.db);
    if (!serverId) {
      return reply.status(503).send({ error: "No active server" });
    }

    const status = await fetchDeepSeaStatus(deps.db, deps.rustPlus, serverId);
    return { status };
  });

  app.get("/internal/devices", async (request, reply) => {
    if (!(await requireInternalBotAccess(deps.db, request, reply, "view"))) return;

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

    if (!(await requireInternalBotAccess(deps.db, request, reply, "switch"))) return;

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
    if (!(await requireInternalBotAccess(deps.db, request, reply, "view"))) return;

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

  app.get("/internal/storage/recycle/:entityDbId", async (request, reply) => {
    if (!(await requireInternalBotAccess(deps.db, request, reply, "view"))) return;

    const { entityDbId } = request.params as { entityDbId: string };
    const [device] = await deps.db
      .select()
      .from(rustEntities)
      .where(and(eq(rustEntities.id, entityDbId), eq(rustEntities.entityType, "storage_monitor")))
      .limit(1);

    if (!device) {
      return reply.status(404).send({ error: "Storage monitor not found" });
    }

    const info = await deps.rustPlus.getEntityInfo(device.entityId);
    const { buildRecycleBreakdownEmbed } = await import("../lib/storage-discord-embed.js");
    const { recycleFromEntityInfo } = await import("../lib/vending.js");
    const recycle = recycleFromEntityInfo(info);
    const embed = buildRecycleBreakdownEmbed(device.displayName ?? device.name, recycle);
    return { embed };
  });

  app.post("/internal/chat", async (request, reply) => {
    const { discordUserId, message, discordUsername } = request.body as {
      discordUserId: string;
      message: string;
      discordUsername?: string;
    };

    if (!(await requireInternalBotAccess(deps.db, request, reply, "switch"))) return;

    if (!message?.trim()) {
      return reply.status(400).send({ error: "message is required" });
    }

    let senderLabel = discordUsername?.trim() ?? "";
    if (!senderLabel && discordUserId) {
      const [row] = await deps.db
        .select({ discordUsername: users.discordUsername })
        .from(users)
        .where(eq(users.discordId, discordUserId))
        .limit(1);
      senderLabel = row?.discordUsername ?? discordUserId;
    }

    const serverId = await getActiveServerId(deps.db);
    if (!serverId) {
      return reply.status(503).send({ error: "No active server" });
    }

    const activeServer = await getActiveServer(deps.db);

    await sendAndPublishTeamChat(
      deps.rustPlus,
      serverId,
      activeServer?.playerId ?? null,
      senderLabel,
      message,
    );
    await logAudit(deps.db, {
      action: "discord_team_chat",
      metadata: { discordUserId, message: message.trim() },
    });
    return { ok: true };
  });

  app.get("/internal/map", async (request, reply) => {
    if (!(await requireInternalBotAccess(deps.db, request, reply, "view"))) return;

    const map = await deps.rustPlus.getMap();
    return {
      imageBase64: map.jpgImage?.toString("base64") ?? null,
      width: map.width,
      height: map.height,
    };
  });

  app.get("/internal/channels", async (request, reply) => {
    const { guildId } = request.query as { guildId?: string };
    if (!guildId?.trim()) {
      return reply.status(400).send({ error: "guildId is required" });
    }

    if (!(await requireInternalBotAccess(deps.db, request, reply, "view", guildId.trim()))) return;

    const guildError = assertGuildAllowed(guildId.trim());
    if (guildError) return reply.status(403).send({ error: guildError });

    const bindings = await listDiscordChannelBindings(deps.db, guildId.trim());
    return { bindings };
  });

  app.post("/internal/channels/bind", async (request, reply) => {
    const { discordUserId, guildId, purpose, channelId } = request.body as {
      discordUserId: string;
      guildId: string;
      purpose: string;
      channelId: string;
    };

    const perm = await requireInternalBotAccess(deps.db, request, reply, "admin", guildId.trim());
    if (!perm) return;

    if (!guildId?.trim() || !channelId?.trim()) {
      return reply.status(400).send({ error: "guildId and channelId are required" });
    }
    if (!isDiscordChannelPurpose(purpose)) {
      return reply.status(400).send({ error: "Invalid channel purpose" });
    }

    const guildError = assertGuildAllowed(guildId.trim());
    if (guildError) return reply.status(403).send({ error: guildError });

    await bindDiscordChannel(deps.db, guildId.trim(), purpose, channelId.trim());

    if (purpose === "information") {
      try {
        await ensureInformationEmbed(deps.db, deps.rustPlus, guildId.trim(), channelId.trim());
      } catch (err) {
        console.error("[InformationEmbed] Failed to post initial board:", err);
      }
    }

    await logAudit(deps.db, {
      action: "discord_channel_bind",
      targetType: "discord_channel",
      targetId: channelId.trim(),
      metadata: { discordUserId, guildId: guildId.trim(), purpose },
    });

    const bindings = await listDiscordChannelBindings(deps.db, guildId.trim());
    return { ok: true, bindings };
  });

  app.post("/internal/channels/clear", async (request, reply) => {
    const { discordUserId, guildId, purpose } = request.body as {
      discordUserId: string;
      guildId: string;
      purpose: string;
    };

    const perm = await requireInternalBotAccess(deps.db, request, reply, "admin", guildId.trim());
    if (!perm) return;

    if (!guildId?.trim()) {
      return reply.status(400).send({ error: "guildId is required" });
    }
    if (!isDiscordChannelPurpose(purpose)) {
      return reply.status(400).send({ error: "Invalid channel purpose" });
    }

    const guildError = assertGuildAllowed(guildId.trim());
    if (guildError) return reply.status(403).send({ error: guildError });

    const cleared = await clearDiscordChannelBinding(deps.db, guildId.trim(), purpose);

    if (purpose === "information") {
      await clearInformationEmbedBinding(deps.db, guildId.trim());
    }

    await logAudit(deps.db, {
      action: "discord_channel_clear",
      targetType: "discord_channel_purpose",
      targetId: purpose,
      metadata: { discordUserId, guildId: guildId.trim(), cleared },
    });

    const bindings = await listDiscordChannelBindings(deps.db, guildId.trim());
    return { ok: true, cleared, bindings };
  });

  app.post("/internal/commands-channel/execute", async (request, reply) => {
    const { guildId, channelId, message, discordUsername } = request.body as {
      discordUserId: string;
      guildId: string;
      channelId: string;
      message: string;
      discordUsername?: string;
    };

    const discordUserId = await requireInternalBotAccess(
      deps.db,
      request,
      reply,
      "switch",
      guildId?.trim(),
    );
    if (!discordUserId) return;

    if (!guildId?.trim() || !channelId?.trim() || !message?.trim()) {
      return reply.status(400).send({ error: "guildId, channelId, and message are required" });
    }

    const guildError = assertGuildAllowed(guildId.trim());
    if (guildError) return reply.status(403).send({ error: guildError });

    const commandsChannel = await resolveDiscordChannelId(deps.db, guildId.trim(), "commands");
    const teamChatChannel = await resolveDiscordChannelId(deps.db, guildId.trim(), "team_chat");
    const trimmedChannel = channelId.trim();
    if (
      trimmedChannel !== commandsChannel &&
      trimmedChannel !== teamChatChannel
    ) {
      return reply.status(403).send({
        error:
          "Use a channel linked with /channel set purpose:commands (or the team chat mirror channel)",
      });
    }

    const serverId = await getActiveServerId(deps.db);
    if (!serverId) {
      return reply.status(503).send({ error: "No active server" });
    }

    const result = await executeTeamChatCommand(deps.db, deps.rustPlus, {
      serverId,
      message: message.trim(),
      discordUserId,
      discordUsername: discordUsername?.trim() || undefined,
    });

    const replies = result?.replies?.length
      ? result.replies
      : result?.reply
        ? [result.reply]
        : [];

    return { replies, embeds: result?.embeds ?? [] };
  });

  app.post("/internal/slash-command/execute", async (request, reply) => {
    const { guildId, message, discordUsername } = request.body as {
      discordUserId: string;
      guildId?: string;
      message: string;
      discordUsername?: string;
    };

    const discordUserId = await requireInternalBotAccess(
      deps.db,
      request,
      reply,
      "switch",
      guildId?.trim(),
    );
    if (!discordUserId) return;

    if (!message?.trim()) {
      return reply.status(400).send({ error: "message is required" });
    }

    if (guildId?.trim()) {
      const guildError = assertGuildAllowed(guildId.trim());
      if (guildError) return reply.status(403).send({ error: guildError });
    }

    const serverId = await getActiveServerId(deps.db);
    if (!serverId) {
      return reply.status(503).send({ error: "No active server" });
    }

    const result = await executeTeamChatCommand(deps.db, deps.rustPlus, {
      serverId,
      message: message.trim(),
      discordUserId,
      discordUsername: discordUsername?.trim() || undefined,
    });

    const replies = result?.replies?.length
      ? result.replies
      : result?.reply
        ? [result.reply]
        : [];

    return { replies, embeds: result?.embeds ?? [] };
  });

  app.get("/internal/blacklist", async (request, reply) => {
    const { guildId } = request.query as { guildId?: string };
    if (!guildId?.trim()) {
      return reply.status(400).send({ error: "guildId is required" });
    }

    if (!(await requireInternalBotAccess(deps.db, request, reply, "admin", guildId.trim()))) return;

    const guildError = assertGuildAllowed(guildId.trim());
    if (guildError) return reply.status(403).send({ error: guildError });

    const entries = await listDiscordBlacklist(deps.db, guildId.trim());
    return { entries };
  });

  app.post("/internal/blacklist/add", async (request, reply) => {
    const { discordUserId, guildId, targetDiscordId, steamId, reason } = request.body as {
      discordUserId: string;
      guildId: string;
      targetDiscordId?: string;
      steamId?: string;
      reason?: string;
    };

    if (!(await requireInternalBotAccess(deps.db, request, reply, "admin", guildId?.trim()))) return;

    if (!guildId?.trim()) {
      return reply.status(400).send({ error: "guildId is required" });
    }

    const guildError = assertGuildAllowed(guildId.trim());
    if (guildError) return reply.status(403).send({ error: guildError });

    try {
      const entry = await addDiscordBlacklistEntry(deps.db, {
        guildId: guildId.trim(),
        discordId: targetDiscordId,
        steamId,
        reason,
        createdBy: discordUserId,
      });

      await logAudit(deps.db, {
        action: "discord_blacklist_add",
        targetType: "blacklist",
        targetId: entry.id,
        metadata: { discordUserId, targetDiscordId, steamId },
      });

      return { ok: true, entry };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add blacklist entry";
      return reply.status(400).send({ error: message });
    }
  });

  app.post("/internal/blacklist/remove", async (request, reply) => {
    const { discordUserId, guildId, targetDiscordId, steamId } = request.body as {
      discordUserId: string;
      guildId: string;
      targetDiscordId?: string;
      steamId?: string;
    };

    if (!(await requireInternalBotAccess(deps.db, request, reply, "admin", guildId?.trim()))) return;

    if (!guildId?.trim()) {
      return reply.status(400).send({ error: "guildId is required" });
    }

    const guildError = assertGuildAllowed(guildId.trim());
    if (guildError) return reply.status(403).send({ error: guildError });

    const removed = await removeDiscordBlacklistEntry(deps.db, guildId.trim(), {
      discordId: targetDiscordId,
      steamId,
    });

    if (removed) {
      await logAudit(deps.db, {
        action: "discord_blacklist_remove",
        metadata: { discordUserId, targetDiscordId, steamId },
      });
    }

    return { ok: true, removed };
  });
}
