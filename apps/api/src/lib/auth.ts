import type { FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { sessions, users } from "@rusttools/db";
import { env } from "../config.js";
import { hashToken } from "./crypto.js";
import { generateId, generateRefreshToken } from "./ids.js";

const REFRESH_COOKIE = "rusttools_refresh";
const ACCESS_COOKIE = "rusttools_access";
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function cookieOptions() {
  const crossOrigin = env.crossOriginFrontend;
  return {
    httpOnly: true,
    secure: env.nodeEnv === "production" || crossOrigin,
    sameSite: crossOrigin ? ("none" as const) : ("lax" as const),
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
  reply.clearCookie(ACCESS_COOKIE, { path: "/" });
  reply.clearCookie(REFRESH_COOKIE, { path: "/" });
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
    return null;
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user) return null;
  return { user, session };
}

/** Rotate refresh token on each authenticated request. */
export async function rotateSessionIfNeeded(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<typeof users.$inferSelect | null> {
  const refreshToken = request.cookies[REFRESH_COOKIE];
  if (!refreshToken) return null;

  const loaded = await loadUserFromRefreshToken(db, refreshToken);
  if (!loaded) return null;

  const newRefresh = generateRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  await db
    .update(sessions)
    .set({
      refreshTokenHash: hashToken(newRefresh),
      expiresAt,
    })
    .where(eq(sessions.id, loaded.session.id));

  setAuthCookies(reply, loaded.session.id, newRefresh, expiresAt);
  return loaded.user;
}

export async function getSessionUser(
  db: Database,
  request: FastifyRequest,
  reply?: FastifyReply,
): Promise<typeof users.$inferSelect | null> {
  if (reply) {
    return rotateSessionIfNeeded(db, request, reply);
  }

  const refreshToken = request.cookies[REFRESH_COOKIE];
  if (!refreshToken) return null;
  const loaded = await loadUserFromRefreshToken(db, refreshToken);
  return loaded?.user ?? null;
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
