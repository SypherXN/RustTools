import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { users } from "@rusttools/db";
import { env } from "../config.js";
import { SESSION_COOKIE_OPTIONS, setAuthCookies, createSession } from "../lib/auth.js";
import { generateId } from "../lib/ids.js";
import { isUserBlocked } from "../lib/user-access.js";

const OAUTH_STATE_COOKIE = "oauth_state";

interface DiscordTokenResponse {
  access_token: string;
}

interface DiscordUser {
  id: string;
  username: string;
  avatar: string | null;
}

function generateOAuthState(): string {
  return randomBytes(24).toString("hex");
}

function buildDiscordAuthorizeParams(state: string): URLSearchParams {
  return new URLSearchParams({
    client_id: env.discord.clientId,
    redirect_uri: env.discord.redirectUri,
    response_type: "code",
    scope: "identify",
    state,
  });
}

function discordAuthorizeUrl(params: URLSearchParams, preferApp: boolean): string {
  const query = params.toString();
  if (preferApp) {
    return `discord://-/oauth2/authorize?${query}`;
  }
  return `https://discord.com/api/oauth2/authorize?${query}`;
}

export async function registerDiscordOAuth(
  app: FastifyInstance,
  db: Database,
): Promise<void> {
  app.get("/auth/discord", async (request, reply) => {
    if (!env.discordOAuthConfigured) {
      return reply.status(503).send({
        error: "Discord OAuth is not configured. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.",
      });
    }

    const state = generateOAuthState();
    reply.setCookie(OAUTH_STATE_COOKIE, state, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: 600,
      signed: true,
    });

    const preferApp = (request.query as { app?: string }).app === "1";
    const params = buildDiscordAuthorizeParams(state);
    return reply.redirect(discordAuthorizeUrl(params, preferApp));
  });

  app.get("/auth/discord/callback", async (request, reply) => {
    if (!env.discordOAuthConfigured) {
      return reply.status(503).send({ error: "Discord OAuth not configured" });
    }

    const { code, state } = request.query as { code?: string; state?: string };
    if (!code) {
      return reply.status(400).send({ error: "Missing authorization code" });
    }

    const cookieState = request.unsignCookie(request.cookies[OAUTH_STATE_COOKIE] ?? "");
    reply.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });

    if (!state || !cookieState.valid || cookieState.value !== state) {
      return reply.redirect(`${env.frontendRedirectUrl}/?error=oauth_state_invalid`);
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
      if (env.isDev) {
        const detail = await tokenRes.text();
        request.log.error({ status: tokenRes.status, detail }, "Discord token exchange failed");
      } else {
        request.log.error({ status: tokenRes.status }, "Discord token exchange failed");
      }
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
        pendingLinkType: null,
        companionPlayerId: null,
        companionTokenEncrypted: null,
        companionLinkedAt: null,
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

    if (await isUserBlocked(db, user)) {
      return reply.redirect(`${env.frontendRedirectUrl}/?error=blocked`);
    }

    const { sessionId, refreshToken, expiresAt } = await createSession(db, user.id);
    setAuthCookies(reply, sessionId, refreshToken, expiresAt);

    const frontendUrl = env.frontendRedirectUrl;
    return reply.type("text/html").send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Signing in…</title></head>
<body><p>Signing in…</p>
<script>window.location.replace(${JSON.stringify(`${frontendUrl}/`)});</script>
</body></html>`);
  });
}
