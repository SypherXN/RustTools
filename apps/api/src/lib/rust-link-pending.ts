import { and, desc, eq, ne } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { users } from "@rusttools/db";
import type { PendingLinkType } from "@rusttools/shared";

export type PendingLinkTypeDb = "steam" | "companion" | "master";

export function normalizeCompanionCredentials(
  playerId: string,
  playerToken: string,
): { playerId: string; playerToken: string } {
  return { playerId: playerId.trim(), playerToken: playerToken.trim() };
}

export function validateCompanionCredentials(playerId: string, playerToken: string): string | null {
  const normalized = normalizeCompanionCredentials(playerId, playerToken);
  if (!normalized.playerId || !normalized.playerToken) {
    return "playerId and playerToken are required";
  }
  if (!/^\d{1,20}$/.test(normalized.playerId)) {
    return "playerId must be a numeric Steam ID (max 20 digits)";
  }
  if (!/^\d{1,12}$/.test(normalized.playerToken)) {
    return "playerToken must be numeric (max 12 digits)";
  }
  return null;
}

export function validateManualSteamId(steamId: string): string | null {
  if (!/^\d{17}$/.test(steamId.trim())) {
    return "steamId must be a 17-digit Steam ID";
  }
  return null;
}

export function validateRustPlusPlayerId(playerId: string): string | null {
  if (!/^\d{1,20}$/.test(playerId.trim())) {
    return "Invalid Rust+ player ID";
  }
  return null;
}

export async function beginPendingLink(
  db: Database,
  userId: string,
  linkType: PendingLinkType,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [self] = await db
    .select({ pendingLinkType: users.pendingLinkType })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (self?.pendingLinkType && self.pendingLinkType !== linkType) {
    return {
      ok: false,
      error:
        "You already have a pending link in progress. Finish it before starting a different link type.",
    };
  }

  const [other] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.pendingLinkType, linkType), ne(users.id, userId)))
    .limit(1);

  if (other) {
    return {
      ok: false,
      error:
        "Another user is already waiting to complete this link. Try again after they finish or cancel.",
    };
  }

  await db
    .update(users)
    .set({ pendingLinkType: linkType, pendingRustLink: true, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return { ok: true };
}

/** Returns the sole pending user, or null if none or ambiguous (multiple pending). */
export async function findExclusivePendingLinkUser(
  db: Database,
  linkType: PendingLinkTypeDb,
): Promise<{ id: string } | null> {
  const pending = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.pendingLinkType, linkType))
    .orderBy(desc(users.updatedAt));

  if (pending.length === 0) return null;
  if (pending.length > 1) {
    console.warn(
      `[FCM] Ignoring ${linkType} pairing: ${pending.length} users have pending ${linkType} links`,
    );
    return null;
  }
  return pending[0] ?? null;
}

/**
 * Atomically claim the sole pending user for a link type.
 * Returns null if none, ambiguous, or already claimed by a concurrent handler.
 */
export async function takeExclusivePendingLinkUser(
  db: Database,
  linkType: PendingLinkTypeDb,
): Promise<{ id: string } | null> {
  const pending = await findExclusivePendingLinkUser(db, linkType);
  if (!pending) return null;

  const now = new Date();
  const claimed = await db
    .update(users)
    .set({ pendingLinkType: null, pendingRustLink: false, updatedAt: now })
    .where(and(eq(users.id, pending.id), eq(users.pendingLinkType, linkType)))
    .returning({ id: users.id });

  if (claimed.length === 0) {
    console.warn(`[FCM] Pending ${linkType} link for ${pending.id} was already consumed`);
    return null;
  }

  return { id: pending.id };
}

export async function assignSteamId(
  db: Database,
  userId: string,
  steamId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = steamId.trim();
  const formatError = validateRustPlusPlayerId(normalized);
  if (formatError) {
    return { ok: false, error: formatError };
  }

  const [conflict] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.steamId, normalized), ne(users.id, userId)))
    .limit(1);

  if (conflict) {
    return { ok: false, error: "This Steam ID is already linked to another account." };
  }

  await db
    .update(users)
    .set({
      steamId: normalized,
      pendingLinkType: null,
      pendingRustLink: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return { ok: true };
}

export async function assignCompanionPlayerId(
  db: Database,
  userId: string,
  playerId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = playerId.trim();
  const formatError = validateRustPlusPlayerId(normalized);
  if (formatError) {
    return { ok: false, error: formatError };
  }

  const [conflict] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.companionPlayerId, normalized), ne(users.id, userId)))
    .limit(1);

  if (conflict) {
    return {
      ok: false,
      error: "This companion Rust+ account is already linked to another user.",
    };
  }

  return { ok: true };
}
