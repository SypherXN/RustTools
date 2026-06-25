import { ilike, or } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { users } from "@rusttools/db";

export async function findDiscordUserIdForSendTarget(
  db: Database,
  target: string,
): Promise<{ discordId: string; discordUsername: string } | null> {
  const needle = target.trim();
  if (!needle) return null;

  const pattern = `%${needle.replace(/[%_]/g, "")}%`;
  const rows = await db
    .select({
      discordId: users.discordId,
      discordUsername: users.discordUsername,
    })
    .from(users)
    .where(or(ilike(users.discordUsername, pattern), ilike(users.discordId, needle)))
    .limit(5);

  if (rows.length === 0) return null;

  const exact = rows.find(
    (row) => row.discordUsername.toLowerCase() === needle.toLowerCase(),
  );
  if (exact) return exact;

  if (rows.length === 1) return rows[0] ?? null;
  return null;
}
