import type { FastifyReply } from "fastify";
import { eq, or } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { pushSubscriptions, sessions, users } from "@rusttools/db";
import { env } from "../config.js";
import { clearAuthCookies } from "./auth.js";
import { isDiscordBlacklisted } from "./discord-blacklist.js";

type UserRow = typeof users.$inferSelect;

export async function isUserBlocked(
  db: Database,
  user: Pick<UserRow, "discordId" | "steamId">,
): Promise<boolean> {
  const guildId = env.discord.guildId?.trim();
  if (!guildId) return false;

  return isDiscordBlacklisted(db, guildId, {
    discordId: user.discordId,
    steamId: user.steamId,
  });
}

/** Returns true when the user is blocked and the response was sent. */
export async function rejectIfBlocked(
  db: Database,
  user: UserRow,
  reply: FastifyReply,
): Promise<boolean> {
  if (!(await isUserBlocked(db, user))) return false;

  clearAuthCookies(reply);
  reply.status(403).send({ error: "You are blocked from RustTools" });
  return true;
}

/** End active sessions and push subscriptions for users matching a block entry. */
export async function revokeBlockedUserAccess(
  db: Database,
  opts: { discordId?: string | null; steamId?: string | null },
): Promise<number> {
  const discordId = opts.discordId?.trim();
  const steamId = opts.steamId?.trim();
  if (!discordId && !steamId) return 0;

  const conditions = [];
  if (discordId) conditions.push(eq(users.discordId, discordId));
  if (steamId) conditions.push(eq(users.steamId, steamId));

  const matched = await db
    .select({ id: users.id })
    .from(users)
    .where(conditions.length === 1 ? conditions[0]! : or(...conditions));

  for (const user of matched) {
    await db.delete(sessions).where(eq(sessions.userId, user.id));
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
  }

  return matched.length;
}
