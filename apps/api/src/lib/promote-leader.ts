import { and, eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustServers, users } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import type { TeamRosterMember } from "@rusttools/shared";
import { decrypt, encrypt } from "./crypto.js";
import {
  assignCompanionPlayerId,
  assignSteamId,
  findExclusivePendingLinkUser,
  normalizeCompanionCredentials,
  takeExclusivePendingLinkUser,
  validateCompanionCredentials,
  validateRustPlusPlayerId,
} from "./rust-link-pending.js";
import { getActiveFcmCredential } from "./fcm-credentials.js";

export type ActiveServerRow = {
  id: string;
  playerId: string;
  ip: string;
  port: number;
};

export async function getActiveServerRow(db: Database): Promise<ActiveServerRow | null> {
  const activeFcm = await getActiveFcmCredential(db);
  if (!activeFcm) return null;

  const [server] = await db
    .select({
      id: rustServers.id,
      playerId: rustServers.playerId,
      ip: rustServers.ip,
      port: rustServers.port,
    })
    .from(rustServers)
    .where(
      and(eq(rustServers.isActive, true), eq(rustServers.fcmCredentialId, activeFcm.id)),
    )
    .limit(1);
  return server ?? null;
}

export async function findCompanionCredentialsForLeader(
  db: Database,
  leaderSteamId: string,
  server: Pick<ActiveServerRow, "ip" | "port">,
): Promise<{ playerId: string; playerToken: string; ip: string; port: number } | null> {
  const [byCompanion] = await db
    .select({
      companionPlayerId: users.companionPlayerId,
      companionTokenEncrypted: users.companionTokenEncrypted,
    })
    .from(users)
    .where(eq(users.companionPlayerId, leaderSteamId))
    .limit(1);

  const row =
    byCompanion?.companionPlayerId && byCompanion.companionTokenEncrypted
      ? byCompanion
      : (
          await db
            .select({
              companionPlayerId: users.companionPlayerId,
              companionTokenEncrypted: users.companionTokenEncrypted,
            })
            .from(users)
            .where(eq(users.steamId, leaderSteamId))
            .limit(1)
        )[0];

  if (!row?.companionPlayerId || !row.companionTokenEncrypted) {
    return null;
  }

  return {
    playerId: row.companionPlayerId,
    playerToken: decrypt(row.companionTokenEncrypted),
    ip: server.ip,
    port: server.port,
  };
}

export async function canPromoteViaRustPlus(
  db: Database,
  activeServer: ActiveServerRow | null,
  leaderSteamId: string | null,
): Promise<boolean> {
  if (!activeServer || !leaderSteamId) return false;
  if (leaderSteamId === activeServer.playerId) return true;
  return (await findCompanionCredentialsForLeader(db, leaderSteamId, activeServer)) != null;
}

export function validatePromoteTarget(member: TeamRosterMember): string | null {
  if (member.isLeader) return "Player is already team leader";
  if (!member.isOnline) return "Player must be online to become team leader";
  if (!member.isAlive) return "Player must be alive to become team leader";
  return null;
}

export class PromoteLeaderError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "PromoteLeaderError";
  }
}

export async function promoteTeamLeader(
  db: Database,
  rustPlus: RustPlusManager,
  activeServer: ActiveServerRow,
  leaderSteamId: string,
  targetSteamId: string,
  targetMember: TeamRosterMember,
): Promise<void> {
  const targetError = validatePromoteTarget(targetMember);
  if (targetError) {
    throw new PromoteLeaderError(targetError);
  }

  if (leaderSteamId === activeServer.playerId) {
    await rustPlus.promoteToLeader(targetSteamId);
    return;
  }

  const companion = await findCompanionCredentialsForLeader(db, leaderSteamId, activeServer);
  if (!companion) {
    throw new PromoteLeaderError(
      "The current team leader must link a companion Rust+ account in Settings, or promote the master bot account first.",
      403,
    );
  }

  await rustPlus.promoteToLeaderWithCredentials(companion, targetSteamId);
}

export async function saveCompanionCredentials(
  db: Database,
  userId: string,
  playerId: string,
  playerToken: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = normalizeCompanionCredentials(playerId, playerToken);
  const validationError = validateCompanionCredentials(normalized.playerId, normalized.playerToken);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const companionConflict = await assignCompanionPlayerId(db, userId, normalized.playerId);
  if (!companionConflict.ok) {
    return companionConflict;
  }

  const now = new Date();
  const [existing] = await db
    .select({ steamId: users.steamId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!existing?.steamId) {
    const steamResult = await assignSteamId(db, userId, normalized.playerId);
    if (!steamResult.ok) {
      return steamResult;
    }
  }

  await db
    .update(users)
    .set({
      companionPlayerId: normalized.playerId,
      companionTokenEncrypted: encrypt(normalized.playerToken),
      companionLinkedAt: now,
      pendingLinkType: null,
      pendingRustLink: false,
      updatedAt: now,
    })
    .where(eq(users.id, userId));

  return { ok: true };
}

export async function findPendingLinkUser(
  db: Database,
  linkType: "steam" | "companion" | "master",
): Promise<{ id: string } | null> {
  return findExclusivePendingLinkUser(db, linkType);
}

export async function applySteamLinkFromPair(
  db: Database,
  playerId: string,
  _now: Date,
): Promise<void> {
  const pending = await takeExclusivePendingLinkUser(db, "steam");
  if (!pending) return;

  const formatError = validateRustPlusPlayerId(playerId);
  if (formatError) {
    console.warn(`[FCM] Steam link rejected for user ${pending.id}: ${formatError}`);
    return;
  }

  const result = await assignSteamId(db, pending.id, playerId);
  if (!result.ok) {
    console.warn(`[FCM] Steam link rejected for user ${pending.id}: ${result.error}`);
  }
}

export async function applyCompanionLinkFromPair(
  db: Database,
  userId: string,
  playerId: string,
  playerToken: string,
  _now: Date,
): Promise<void> {
  const normalized = normalizeCompanionCredentials(playerId, playerToken);
  const validationError = validateCompanionCredentials(normalized.playerId, normalized.playerToken);
  if (validationError) {
    console.warn(`[FCM] Companion link rejected for user ${userId}: ${validationError}`);
    return;
  }

  const companionConflict = await assignCompanionPlayerId(db, userId, normalized.playerId);
  if (!companionConflict.ok) {
    console.warn(`[FCM] Companion link rejected for user ${userId}: ${companionConflict.error}`);
    return;
  }

  const [existing] = await db
    .select({ steamId: users.steamId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!existing?.steamId) {
    const steamResult = await assignSteamId(db, userId, normalized.playerId);
    if (!steamResult.ok) {
      console.warn(`[FCM] Companion link rejected for user ${userId}: ${steamResult.error}`);
      return;
    }
  }

  const now = new Date();
  await db
    .update(users)
    .set({
      companionPlayerId: normalized.playerId,
      companionTokenEncrypted: encrypt(normalized.playerToken),
      companionLinkedAt: now,
      pendingLinkType: null,
      pendingRustLink: false,
      updatedAt: now,
    })
    .where(eq(users.id, userId));
}
