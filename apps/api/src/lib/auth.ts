import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Database } from "@rusttools/db";
import { sessions, users } from "@rusttools/db";
import { env } from "../config.js";
import { hashToken } from "./crypto.js";
import { generateId, generateRefreshToken } from "./ids.js";
import {
  hasDiscordCapability,
  type DiscordCapability,
} from "./discord-permissions.js";
import { rejectIfBlocked } from "./user-access.js";

const REFRESH_COOKIE = "rusttools_refresh";
const ACCESS_COOKIE = "rusttools_access";
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function registrableDomain(host: string): string {
  const normalized = host.toLowerCase().replace(/\.$/, "");
  const parts = normalized.split(".");
  if (parts.length <= 2) return normalized;
  return parts.slice(-2).join(".");
}

function cookieOptions() {
  const apiHttps = env.apiPublicUrl.startsWith("https://");
  let apiHost = "";
  try {
    apiHost = new URL(env.apiPublicUrl).hostname;
  } catch {
    apiHost = "";
  }

  // UI on rusttools.example.com + API on rusttools-api.example.com share a registrable
  // domain — SameSite=Lax works and is more reliable than None for credentialed fetches.
  const sameRegistrableDomain =
    apiHost.length > 0 &&
    env.corsOrigins.some((origin) => {
      try {
        return registrableDomain(new URL(origin).hostname) === registrableDomain(apiHost);
      } catch {
        return false;
      }
    });

  const crossSite = env.crossOriginFrontend && apiHttps && !sameRegistrableDomain;
  return {
    httpOnly: true,
    secure: apiHttps,
    sameSite: crossSite ? ("none" as const) : ("lax" as const),
    path: "/",
  };
}

export const SESSION_COOKIE_OPTIONS = cookieOptions();

export function setAuthCookies(
  reply: FastifyReply,
  sessionId: string,
  refreshToken: string,
  refreshExpiresAt: Date,
): void {
  reply.setCookie(ACCESS_COOKIE, sessionId, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 15 * 60,
  });
  reply.setCookie(REFRESH_COOKIE, refreshToken, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: Math.floor((refreshExpiresAt.getTime() - Date.now()) / 1000),
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  const opts = SESSION_COOKIE_OPTIONS;
  reply.clearCookie(ACCESS_COOKIE, { path: "/", sameSite: opts.sameSite, secure: opts.secure });
  reply.clearCookie(REFRESH_COOKIE, { path: "/", sameSite: opts.sameSite, secure: opts.secure });
}

async function loadUserFromRefreshToken(
  db: Database,
  refreshToken: string,
): Promise<{ user: typeof users.$inferSelect; session: typeof sessions.$inferSelect } | null> {
  const tokenHash = hashToken(refreshToken);
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.refreshTokenHash, tokenHash))
    .limit(1);

  if (!session || session.expiresAt < new Date()) {
    if (session) {
      await db.delete(sessions).where(eq(sessions.id, session.id));
    }
    return null;
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user) return null;
  return { user, session };
}

export async function getSessionUser(
  db: Database,
  request: FastifyRequest,
  reply?: FastifyReply,
): Promise<typeof users.$inferSelect | null> {
  const refreshToken = request.cookies[REFRESH_COOKIE];
  if (!refreshToken) return null;

  const loaded = await loadUserFromRefreshToken(db, refreshToken);
  if (!loaded) return null;

  // Re-emit cookies to refresh max-age. Do not rotate the refresh token on every
  // request — that invalidates the browser cookie when Set-Cookie from cross-origin
  // XHR is not persisted (GitHub Pages UI + API subdomain).
  if (reply) {
    setAuthCookies(reply, loaded.session.id, refreshToken, loaded.session.expiresAt);
  }

  return loaded.user;
}

export async function requireAuth(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<typeof users.$inferSelect | null> {
  const user = await getSessionUser(db, request, reply);
  if (!user) {
    reply.status(401).send({ error: "Unauthorized" });
    return null;
  }
  if (await rejectIfBlocked(db, user, reply)) return null;
  return user;
}

export async function requireCapability(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  capability: DiscordCapability,
): Promise<typeof users.$inferSelect | null> {
  const user = await requireAuth(db, request, reply);
  if (!user) return null;

  if (!(await hasDiscordCapability(user.discordId, capability))) {
    reply.status(403).send({ error: `Missing ${capability} permission` });
    return null;
  }

  return user;
}

export async function createSession(
  db: Database,
  userId: string,
): Promise<{ sessionId: string; refreshToken: string; expiresAt: Date }> {
  const refreshToken = generateRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  const sessionId = generateId();
  const now = new Date();

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    refreshTokenHash: hashToken(refreshToken),
    expiresAt,
    createdAt: now,
  });

  return { sessionId, refreshToken, expiresAt };
}

export function getRefreshCookie(request: FastifyRequest): string | undefined {
  return request.cookies[REFRESH_COOKIE];
}
