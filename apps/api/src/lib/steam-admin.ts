import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { users } from "@rusttools/db";
import { hasDiscordCapability } from "./discord-permissions.js";

export async function steamIdForDiscordUser(
  db: Database,
  discordUserId: string,
): Promise<string | null> {
  const [user] = await db
    .select({ steamId: users.steamId })
    .from(users)
    .where(eq(users.discordId, discordUserId))
    .limit(1);
  return user?.steamId ?? null;
}

export async function hasSteamAdminCapability(
  db: Database,
  steamId: string,
): Promise<boolean> {
  const [user] = await db
    .select({ discordId: users.discordId })
    .from(users)
    .where(eq(users.steamId, steamId))
    .limit(1);

  if (!user) return false;
  return hasDiscordCapability(user.discordId, "admin");
}
