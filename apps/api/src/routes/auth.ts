import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { sessions, users } from "@rusttools/db";
import {
  clearAuthCookies,
  getSessionUser,
  requireAuth,
} from "../lib/auth.js";
import { issueWsToken } from "../lib/ws-tokens.js";
import { registerDiscordOAuth } from "./auth-discord.js";

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
    };
  });

  app.post("/auth/link-rust", async (request, reply) => {
    const user = await requireAuth(db, request, reply);
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
    const user = await requireAuth(db, request, reply);
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
