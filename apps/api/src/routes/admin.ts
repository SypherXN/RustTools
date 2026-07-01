import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { users } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { validateFcmConfigPayload } from "@rusttools/rustplus-client";
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
import {
  activateFcmCredential,
  createFcmCredential,
  deleteFcmCredential,
  getActiveFcmCredentialStatus,
  listFcmCredentialSummaries,
  renameFcmCredential,
  replaceFcmCredentialConfig,
} from "../lib/fcm-credentials.js";
import {
  assignSteamId,
  clearSteamId,
  validateManualSteamId,
} from "../lib/rust-link-pending.js";
import { deleteUserAccount, listAdminUsers } from "../lib/user-admin.js";
import { revokeBlockedUserAccess } from "../lib/user-access.js";

export async function registerAdminRoutes(
  app: FastifyInstance,
  deps: { db: Database; rustPlus: RustPlusManager },
): Promise<void> {
  app.get("/admin/fcm-status", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    return getActiveFcmCredentialStatus(deps.db, deps.rustPlus);
  });

  app.get("/admin/fcm-credentials", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const credentials = await listFcmCredentialSummaries(deps.db, deps.rustPlus);
    return { credentials };
  });

  app.post("/admin/fcm-credentials", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { label: labelQuery } = request.query as { label?: string };
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: "Missing fcm-config.json upload" });

    const label = (labelQuery ?? "").trim() || file.filename.replace(/\.json$/i, "") || "Master bot";

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

    try {
      const credential = await createFcmCredential(
        deps.db,
        deps.rustPlus,
        label,
        validated.config,
      );

      await logAudit(deps.db, {
        userId: user.id,
        action: "fcm_credential_created",
        targetType: "fcm_credential",
        targetId: credential.id,
        metadata: { label: credential.label },
      });

      return { ok: true, credential };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add FCM credential";
      return reply.status(400).send({ error: message });
    }
  });

  app.post("/admin/fcm-credentials/:id/replace", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { id } = request.params as { id: string };
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

    try {
      const credential = await replaceFcmCredentialConfig(
        deps.db,
        deps.rustPlus,
        id,
        validated.config,
      );

      await logAudit(deps.db, {
        userId: user.id,
        action: "fcm_credential_replaced",
        targetType: "fcm_credential",
        targetId: id,
      });

      return { ok: true, credential };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to replace FCM credential";
      return reply.status(400).send({ error: message });
    }
  });

  app.post("/admin/fcm-credentials/:id/activate", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { id } = request.params as { id: string };

    try {
      const credential = await activateFcmCredential(deps.db, deps.rustPlus, id);
      await logAudit(deps.db, {
        userId: user.id,
        action: "fcm_credential_activated",
        targetType: "fcm_credential",
        targetId: id,
        metadata: { label: credential.label },
      });
      return { ok: true, credential };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to activate FCM credential";
      return reply.status(400).send({ error: message });
    }
  });

  app.patch("/admin/fcm-credentials/:id", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { id } = request.params as { id: string };
    const { label } = request.body as { label?: string };
    if (!label?.trim()) {
      return reply.status(400).send({ error: "label is required" });
    }

    try {
      await renameFcmCredential(deps.db, id, label);
      const credentials = await listFcmCredentialSummaries(deps.db, deps.rustPlus);
      const credential = credentials.find((row) => row.id === id);
      return { ok: true, credential };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to rename FCM credential";
      return reply.status(400).send({ error: message });
    }
  });

  app.delete("/admin/fcm-credentials/:id", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { id } = request.params as { id: string };

    try {
      await deleteFcmCredential(deps.db, deps.rustPlus, id, { userId: user.id });
      const credentials = await listFcmCredentialSummaries(deps.db, deps.rustPlus);
      return { ok: true, credentials };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete FCM credential";
      return reply.status(400).send({ error: message });
    }
  });

  /** @deprecated use POST /admin/fcm-credentials — adds or replaces active slot */
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

    const existing = await listFcmCredentialSummaries(deps.db, deps.rustPlus);
    const active = existing.find((row) => row.isActive);

    try {
      const credential = active
        ? await replaceFcmCredentialConfig(deps.db, deps.rustPlus, active.id, validated.config)
        : await createFcmCredential(deps.db, deps.rustPlus, "Default master", validated.config, {
            activate: true,
          });

      await logAudit(deps.db, {
        userId: user.id,
        action: "fcm_config_upload",
        targetType: "fcm_credential",
        targetId: credential.id,
      });

      return {
        ok: true,
        status: await getActiveFcmCredentialStatus(deps.db, deps.rustPlus),
        credential,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start FCM listener";
      return reply.status(400).send({ error: message });
    }
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

  app.patch("/admin/users/:userId/steam-id", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { userId } = request.params as { userId: string };
    const body = (request.body ?? {}) as { steamId?: string | null };
    const raw = body.steamId;

    const [target] = await deps.db
      .select({ id: users.id, discordUsername: users.discordUsername })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!target) {
      return reply.status(404).send({ error: "User not found" });
    }

    if (raw == null || String(raw).trim() === "") {
      await clearSteamId(deps.db, userId);
      await logAudit(deps.db, {
        userId: user.id,
        action: "user_steam_clear",
        targetType: "user",
        targetId: userId,
        metadata: { discordUsername: target.discordUsername },
      });
      return { ok: true, steamId: null };
    }

    const steamId = String(raw).trim();
    const formatError = validateManualSteamId(steamId);
    if (formatError) {
      return reply.status(400).send({ error: formatError });
    }

    const result = await assignSteamId(deps.db, userId, steamId);
    if (!result.ok) {
      return reply.status(409).send({ error: result.error });
    }

    await logAudit(deps.db, {
      userId: user.id,
      action: "user_steam_assign",
      targetType: "user",
      targetId: userId,
      metadata: { discordUsername: target.discordUsername, steamId },
    });

    return { ok: true, steamId };
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
