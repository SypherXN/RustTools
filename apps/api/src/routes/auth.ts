import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { sessions, users, pushSubscriptions } from "@rusttools/db";
import type { PendingLinkType } from "@rusttools/shared";
import {
  clearAuthCookies,
  getSessionUser,
  requireAuth,
  requireCapability,
} from "../lib/auth.js";
import { resolveUserPermissions } from "../lib/discord-permissions.js";
import { saveCompanionCredentials } from "../lib/promote-leader.js";
import {
  assignSteamId,
  beginPendingLink,
  validateManualSteamId,
} from "../lib/rust-link-pending.js";
import { issueWsToken } from "../lib/ws-tokens.js";
import { registerDiscordOAuth } from "./auth-discord.js";

function authResponse(user: typeof users.$inferSelect, permissions: Awaited<ReturnType<typeof resolveUserPermissions>>) {
  return {
    user: {
      id: user.id,
      discordId: user.discordId,
      discordUsername: user.discordUsername,
      discordAvatar: user.discordAvatar,
      steamId: user.steamId,
      companionPlayerId: user.companionPlayerId,
    },
    linkedRust: Boolean(user.steamId),
    linkedSteam: Boolean(user.steamId),
    companionLinked: Boolean(user.companionPlayerId),
    pendingLinkType: user.pendingLinkType as PendingLinkType | null,
    permissions: {
      view: permissions.view,
      switch: permissions.switch,
      admin: permissions.admin,
    },
    rolesConfigured: permissions.rolesConfigured,
  };
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  db: Database,
): Promise<void> {
  await registerDiscordOAuth(app, db);

  app.get("/auth/me", async (request, reply) => {
    const user = await getSessionUser(db, request, reply);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const permissions = await resolveUserPermissions(user.discordId);
    return authResponse(user, permissions);
  });

  app.post("/auth/link-steam", async (request, reply) => {
    const user = await requireCapability(db, request, reply, "view");
    if (!user) return;

    const body = (request.body ?? {}) as { steamId?: string };
    const steamId = body.steamId?.trim();

    if (steamId) {
      const formatError = validateManualSteamId(steamId);
      if (formatError) {
        return reply.status(400).send({ error: formatError });
      }
      const result = await assignSteamId(db, user.id, steamId);
      if (!result.ok) {
        return reply.status(409).send({ error: result.error });
      }
      return {
        ok: true,
        message: "Steam ID linked.",
      };
    }

    const pending = await beginPendingLink(db, user.id, "steam");
    if (!pending.ok) {
      return reply.status(409).send({ error: pending.error });
    }
    return {
      ok: true,
      message:
        "Pending Steam link. Pair a device in-game on the master Rust+ account, or enter your Steam ID below (F1 → player.id).",
    };
  });

  app.post("/auth/link-companion", async (request, reply) => {
    const user = await requireCapability(db, request, reply, "view");
    if (!user) return;

    const body = (request.body ?? {}) as { playerId?: string; playerToken?: string };
    const playerId = body.playerId?.trim();
    const playerToken = body.playerToken?.trim();

    if (playerId && playerToken) {
      const result = await saveCompanionCredentials(db, user.id, playerId, playerToken);
      if (!result.ok) {
        const status =
          result.error.includes("already linked") || result.error.includes("companion Rust+")
            ? 409
            : 400;
        return reply.status(status).send({ error: result.error });
      }
      return {
        ok: true,
        message: "Companion Rust+ credentials saved. You can now promote when you are team leader.",
      };
    }

    const pending = await beginPendingLink(db, user.id, "companion");
    if (!pending.ok) {
      return reply.status(409).send({ error: pending.error });
    }
    return {
      ok: true,
      message:
        "Pending companion link. Run fcm-register locally, pair with server in Rust+, then paste playerId and playerToken here.",
    };
  });

  app.delete("/auth/link-companion", async (request, reply) => {
    const user = await requireCapability(db, request, reply, "view");
    if (!user) return;

    await db
      .update(users)
      .set({
        companionPlayerId: null,
        companionTokenEncrypted: null,
        companionLinkedAt: null,
        pendingLinkType: user.pendingLinkType === "companion" ? null : user.pendingLinkType,
        pendingRustLink: user.pendingLinkType === "companion" ? false : user.pendingRustLink,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return { ok: true };
  });

  app.post("/auth/link-master", async (request, reply) => {
    const user = await requireCapability(db, request, reply, "admin");
    if (!user) return;

    const pending = await beginPendingLink(db, user.id, "master");
    if (!pending.ok) {
      return reply.status(409).send({ error: pending.error });
    }
    return {
      ok: true,
      message:
        "Pending master server pair. Pair your server in-game while the bot FCM listener is running.",
    };
  });

  app.post("/auth/link-rust", async (request, reply) => {
    const user = await requireCapability(db, request, reply, "admin");
    if (!user) return;

    const pending = await beginPendingLink(db, user.id, "master");
    if (!pending.ok) {
      return reply.status(409).send({ error: pending.error });
    }
    return {
      ok: true,
      message:
        "Pending master server pair. Pair your server in-game while the bot FCM listener is running.",
    };
  });

  app.get("/auth/ws-token", async (request, reply) => {
    const user = await requireCapability(db, request, reply, "view");
    if (!user) return;

    return { token: issueWsToken(user.id) };
  });

  app.post("/auth/logout", async (request, reply) => {
    const user = await requireAuth(db, request, reply);
    if (!user) return;

    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
    await db.delete(sessions).where(eq(sessions.userId, user.id));
    clearAuthCookies(reply);
    return { ok: true };
  });
}
