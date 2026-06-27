import type { FastifyInstance } from "fastify";
import type { Database } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import {
  getFcmCredentialStatus,
  validateFcmConfigPayload,
} from "@rusttools/rustplus-client";
import { DATA_RESET_SCOPES, isDataResetScope } from "@rusttools/shared";
import { env } from "../config.js";
import { logAudit } from "../lib/audit.js";
import { requireCapability } from "../lib/auth.js";
import { executeDataReset } from "../lib/data-reset.js";
import {
  addDiscordBlacklistEntry,
  listDiscordBlacklist,
  removeDiscordBlacklistEntry,
} from "../lib/discord-blacklist.js";
import { replaceFcmConfigFile } from "../lib/fcm-config-upload.js";
import { deleteUserAccount, listAdminUsers } from "../lib/user-admin.js";
import { revokeBlockedUserAccess } from "../lib/user-access.js";

export async function registerAdminRoutes(
  app: FastifyInstance,
  deps: { db: Database; rustPlus: RustPlusManager },
): Promise<void> {
  app.get("/admin/fcm-status", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const rustStatus = deps.rustPlus.getStatus();
    return getFcmCredentialStatus(env.rustplus.resolvedFcmConfigPath, rustStatus.fcmListening);
  });

  app.post("/admin/fcm-config/upload", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const file = await request.file();
    if (!file) return reply.status(400).send({ error: "Missing fcm-config.json upload" });

    let parsed: unknown;
    try {
      const text = (await file.toBuffer()).toString("utf8");
      parsed = JSON.parse(text);
    } catch {
      return reply.status(400).send({ error: "Invalid JSON file" });
    }

    const validated = validateFcmConfigPayload(parsed);
    if (!validated.ok) {
      return reply.status(400).send({ error: validated.error });
    }

    const configPath = env.rustplus.resolvedFcmConfigPath;
    try {
      await replaceFcmConfigFile(deps.rustPlus, configPath, validated.config);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start FCM listener";
      return reply.status(400).send({ error: message });
    }

    await logAudit(deps.db, {
      userId: user.id,
      action: "fcm_config_upload",
      targetType: "fcm_config",
      targetId: configPath,
    });

    const rustStatus = deps.rustPlus.getStatus();
    return {
      ok: true,
      status: getFcmCredentialStatus(configPath, rustStatus.fcmListening),
    };
  });

  app.get("/admin/data-reset/scopes", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;
    return { scopes: DATA_RESET_SCOPES };
  });

  app.post("/admin/data-reset", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { scope } = request.body as { scope?: string };
    if (!scope || !isDataResetScope(scope)) {
      return reply.status(400).send({ error: "Invalid reset scope" });
    }

    const result = await executeDataReset(deps.db, deps.rustPlus, scope);

    await logAudit(deps.db, {
      userId: user.id,
      action: "data_reset",
      targetType: "reset_scope",
      targetId: scope,
      metadata: { detail: result.detail },
    });

    return { ok: true, ...result };
  });

  app.get("/admin/users", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;
    return { users: await listAdminUsers(deps.db) };
  });

  app.delete("/admin/users/:userId", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { userId } = request.params as { userId: string };
    if (userId === user.id) {
      return reply.status(400).send({ error: "You cannot remove your own account" });
    }

    const removed = await deleteUserAccount(deps.db, userId);
    if (!removed) {
      return reply.status(404).send({ error: "User not found" });
    }

    await logAudit(deps.db, {
      userId: user.id,
      action: "user_remove",
      targetType: "user",
      targetId: userId,
    });

    return { ok: true };
  });

  app.get("/admin/blacklist", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const guildId = env.discord.guildId?.trim();
    if (!guildId) {
      return reply.status(503).send({ error: "DISCORD_GUILD_ID is not configured" });
    }

    return { entries: await listDiscordBlacklist(deps.db, guildId) };
  });

  app.post("/admin/blacklist", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const guildId = env.discord.guildId?.trim();
    if (!guildId) {
      return reply.status(503).send({ error: "DISCORD_GUILD_ID is not configured" });
    }

    const body = request.body as {
      discordId?: string;
      steamId?: string;
      reason?: string;
    };

    try {
      const entry = await addDiscordBlacklistEntry(deps.db, {
        guildId,
        discordId: body.discordId,
        steamId: body.steamId,
        reason: body.reason,
        createdBy: user.id,
      });

      await revokeBlockedUserAccess(deps.db, {
        discordId: entry.discordId,
        steamId: entry.steamId,
      });

      await logAudit(deps.db, {
        userId: user.id,
        action: "discord_blacklist_add",
        targetType: "blacklist",
        targetId: entry.id,
        metadata: { discordId: entry.discordId, steamId: entry.steamId },
      });

      return { ok: true, entry };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add blacklist entry";
      return reply.status(400).send({ error: message });
    }
  });

  app.delete("/admin/blacklist/:entryId", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const guildId = env.discord.guildId?.trim();
    if (!guildId) {
      return reply.status(503).send({ error: "DISCORD_GUILD_ID is not configured" });
    }

    const { entryId } = request.params as { entryId: string };
    const entries = await listDiscordBlacklist(deps.db, guildId);
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) {
      return reply.status(404).send({ error: "Blacklist entry not found" });
    }

    const removed = await removeDiscordBlacklistEntry(deps.db, guildId, {
      discordId: entry.discordId,
      steamId: entry.steamId,
    });
    if (!removed) {
      return reply.status(404).send({ error: "Blacklist entry not found" });
    }

    await logAudit(deps.db, {
      userId: user.id,
      action: "discord_blacklist_remove",
      targetType: "blacklist",
      targetId: entryId,
    });

    return { ok: true };
  });
}
