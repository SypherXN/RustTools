import { and, eq, or } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { discordBlacklist } from "@rusttools/db";
import type { DiscordBlacklistEntry } from "@rusttools/shared";
import { generateId } from "./ids.js";

function toEntry(row: typeof discordBlacklist.$inferSelect): DiscordBlacklistEntry {
  return {
    id: row.id,
    guildId: row.guildId,
    discordId: row.discordId,
    steamId: row.steamId,
    reason: row.reason,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listDiscordBlacklist(
  db: Database,
  guildId: string,
): Promise<DiscordBlacklistEntry[]> {
  const rows = await db
    .select()
    .from(discordBlacklist)
    .where(eq(discordBlacklist.guildId, guildId));

  return rows
    .map(toEntry)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function isDiscordBlacklisted(
  db: Database,
  guildId: string,
  opts: { discordId?: string | null; steamId?: string | null },
): Promise<boolean> {
  const discordId = opts.discordId?.trim();
  const steamId = opts.steamId?.trim();
  if (!discordId && !steamId) return false;

  const conditions = [];
  if (discordId) conditions.push(eq(discordBlacklist.discordId, discordId));
  if (steamId) conditions.push(eq(discordBlacklist.steamId, steamId));

  const [row] = await db
    .select({ id: discordBlacklist.id })
    .from(discordBlacklist)
    .where(and(eq(discordBlacklist.guildId, guildId), or(...conditions)))
    .limit(1);

  return Boolean(row);
}

export async function addDiscordBlacklistEntry(
  db: Database,
  input: {
    guildId: string;
    discordId?: string | null;
    steamId?: string | null;
    reason?: string;
    createdBy?: string | null;
  },
): Promise<DiscordBlacklistEntry> {
  const discordId = input.discordId?.trim() || null;
  const steamId = input.steamId?.trim() || null;
  if (!discordId && !steamId) {
    throw new Error("Provide a Discord user or Steam ID to blacklist");
  }

  const existing = await isDiscordBlacklisted(db, input.guildId, { discordId, steamId });
  if (existing) {
    throw new Error("User is already blacklisted");
  }

  const id = generateId();
  const now = new Date();
  await db.insert(discordBlacklist).values({
    id,
    guildId: input.guildId,
    discordId,
    steamId,
    reason: input.reason?.trim() ?? "",
    createdBy: input.createdBy ?? null,
    createdAt: now,
  });

  const [row] = await db.select().from(discordBlacklist).where(eq(discordBlacklist.id, id)).limit(1);
  if (!row) throw new Error("Failed to create blacklist entry");
  return toEntry(row);
}

export async function removeDiscordBlacklistEntry(
  db: Database,
  guildId: string,
  opts: { discordId?: string | null; steamId?: string | null },
): Promise<boolean> {
  const discordId = opts.discordId?.trim();
  const steamId = opts.steamId?.trim();
  if (!discordId && !steamId) return false;

  const conditions = [];
  if (discordId) conditions.push(eq(discordBlacklist.discordId, discordId));
  if (steamId) conditions.push(eq(discordBlacklist.steamId, steamId));

  const rows = await db
    .select({ id: discordBlacklist.id })
    .from(discordBlacklist)
    .where(and(eq(discordBlacklist.guildId, guildId), or(...conditions)));

  if (!rows.length) return false;

  for (const row of rows) {
    await db.delete(discordBlacklist).where(eq(discordBlacklist.id, row.id));
  }
  return true;
}
