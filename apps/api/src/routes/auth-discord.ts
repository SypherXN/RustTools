import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { users } from "@rusttools/db";
import { env } from "../config.js";
import { setAuthCookies, createSession } from "../lib/auth.js";
import { generateId } from "../lib/ids.js";

interface DiscordTokenResponse {
  access_token: string;
}

interface DiscordUser {
  id: string;
  username: string;
  avatar: string | null;
}

export async function registerDiscordOAuth(
  app: FastifyInstance,
  db: Database,
): Promise<void> {
  app.get("/auth/discord", async (_request, reply) => {
    if (!env.discordOAuthConfigured) {
      return reply.status(503).send({
        error: "Discord OAuth is not configured. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.",
      });
    }

    const params = new URLSearchParams({
      client_id: env.discord.clientId,
      redirect_uri: env.discord.redirectUri,
      response_type: "code",
      scope: "identify",
    });

    return reply.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
  });

  app.get("/auth/discord/callback", async (request, reply) => {
    if (!env.discordOAuthConfigured) {
      return reply.status(503).send({ error: "Discord OAuth not configured" });
    }

    const { code } = request.query as { code?: string };
    if (!code) {
      return reply.status(400).send({ error: "Missing authorization code" });
    }

    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.discord.clientId,
        client_secret: env.discord.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: env.discord.redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const detail = await tokenRes.text();
      request.log.error({ detail }, "Discord token exchange failed");
      return reply.redirect(`${env.frontendRedirectUrl}/?error=discord_token_failed`);
    }

    const tokens = (await tokenRes.json()) as DiscordTokenResponse;
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userRes.ok) {
      return reply.status(502).send({ error: "Failed to fetch Discord user" });
    }

    const discordUser = (await userRes.json()) as DiscordUser;
    const now = new Date();

    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.discordId, discordUser.id))
      .limit(1);

    let user = existing;
    if (!user) {
      const id = generateId();
      await db.insert(users).values({
        id,
        discordId: discordUser.id,
        discordUsername: discordUser.username,
        discordAvatar: discordUser.avatar,
        steamId: null,
        pendingRustLink: false,
        createdAt: now,
        updatedAt: now,
      });
      user = {
        id,
        discordId: discordUser.id,
        discordUsername: discordUser.username,
        discordAvatar: discordUser.avatar,
        steamId: null,
        pendingRustLink: false,
        createdAt: now,
        updatedAt: now,
      };
    } else {
      await db
        .update(users)
        .set({
          discordUsername: discordUser.username,
          discordAvatar: discordUser.avatar,
          updatedAt: now,
        })
        .where(eq(users.id, user.id));
    }

    const { sessionId, refreshToken, expiresAt } = await createSession(db, user.id);
    setAuthCookies(reply, sessionId, refreshToken, expiresAt);

    const frontendUrl = env.frontendRedirectUrl;
    // 200 + JS redirect so Set-Cookie is stored before leaving the callback URL
    // (302 through the Vite dev proxy can drop cookies in some browsers).
    return reply.type("text/html").send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Signing in…</title></head>
<body><p>Signing in…</p>
<script>window.location.replace(${JSON.stringify(`${frontendUrl}/`)});</script>
</body></html>`);
  });
}
