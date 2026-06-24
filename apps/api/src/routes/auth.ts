import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { sessions, users } from "@rusttools/db";
import {
  clearAuthCookies,
  getSessionUser,
  requireAuth,
  requireCapability,
} from "../lib/auth.js";
import { resolveUserPermissions } from "../lib/discord-permissions.js";
import { issueWsToken } from "../lib/ws-tokens.js";
import { registerDiscordOAuth } from "./auth-discord.js";

export async function registerAuthRoutes(
  app: FastifyInstance,
  db: Database,
): Promise<void> {
  await registerDiscordOAuth(app, db);

  app.get("/auth/me", async (request, reply) => {
    const user = await getSessionUser(db, request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const permissions = await resolveUserPermissions(user.discordId);

    return {
      user: {
        id: user.id,
        discordId: user.discordId,
        discordUsername: user.discordUsername,
        discordAvatar: user.discordAvatar,
        steamId: user.steamId,
      },
      linkedRust: Boolean(user.steamId),
      pendingRustLink: user.pendingRustLink,
      permissions: {
        view: permissions.view,
        switch: permissions.switch,
        admin: permissions.admin,
      },
      rolesConfigured: permissions.rolesConfigured,
    };
  });

  app.post("/auth/link-rust", async (request, reply) => {
    const user = await requireCapability(db, request, reply, "admin");
    if (!user) return;

    await db
      .update(users)
      .set({ pendingRustLink: true, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    return {
      ok: true,
      message:
        "Pending Rust+ link. Pair your server in-game while FCM is listening. Your Steam ID will be linked automatically.",
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

    await db.delete(sessions).where(eq(sessions.userId, user.id));
    clearAuthCookies(reply);
    return { ok: true };
  });
}
