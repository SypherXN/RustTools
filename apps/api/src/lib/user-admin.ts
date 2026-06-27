import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { users } from "@rusttools/db";
import type { AdminUserSummary } from "@rusttools/shared";
import { env } from "../config.js";
import { isDiscordBlacklisted } from "./discord-blacklist.js";

export async function listAdminUsers(db: Database): Promise<AdminUserSummary[]> {
  const guildId = env.discord.guildId?.trim();
  const rows = await db.select().from(users);

  const summaries: AdminUserSummary[] = [];
  for (const row of rows) {
    const blocked =
      guildId &&
      (await isDiscordBlacklisted(db, guildId, {
        discordId: row.discordId,
        steamId: row.steamId,
      }));

    summaries.push({
      id: row.id,
      discordId: row.discordId,
      discordUsername: row.discordUsername,
      steamId: row.steamId,
      createdAt: row.createdAt.toISOString(),
      blocked: Boolean(blocked),
    });
  }

  return summaries.sort((a, b) => a.discordUsername.localeCompare(b.discordUsername));
}

export async function deleteUserAccount(db: Database, userId: string): Promise<boolean> {
  const result = await db.delete(users).where(eq(users.id, userId));
  return result.changes > 0;
}
