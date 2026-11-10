import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities, rustServers } from "@rusttools/db";
import type { EntityType } from "@rusttools/shared";
import type { NotificationService, ParsedFcmNotification, RustPlusManager } from "@rusttools/rustplus-client";
import { env } from "../config.js";
import { encrypt } from "../lib/crypto.js";
import { generateId } from "../lib/ids.js";
import {
  applyCompanionLinkFromPair,
  applySteamLinkFromPair,
} from "../lib/promote-leader.js";
import {
  findExclusivePendingLinkUser,
  takeExclusivePendingLinkUser,
  validateCompanionCredentials,
  validateRustPlusPlayerId,
} from "../lib/rust-link-pending.js";
import { requireActiveFcmCredentialId } from "../lib/fcm-credentials.js";
import { reconnectRustServer, sanitizeRustPlusError } from "./rustplus-bootstrap.js";

const COMPANION_GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ZERO_COMPANION_GUID = "00000000-0000-0000-0000-000000000000";

type PairTransport =
  | { mode: "relay"; companionServerId: string; ip: string; port: number }
  | { mode: "legacy"; ip: string; port: number }
  | { mode: "none" };

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Rust+ player ids/tokens arrive as strings, but older payloads used numbers. */
function readCredential(value: unknown): string | null {
  if (typeof value === "number") {
    // Tokens may be negative or zero; player-id rules are enforced separately.
    return Number.isSafeInteger(value) ? String(value) : null;
  }
  return readNonEmptyString(value);
}

/** Modern Rust+ pairing sends a companion GUID; older payloads send ip:port. */
function readPairTransport(data: {
  id?: string;
  ip?: string;
  port?: string | number;
}): { transport: PairTransport; reason: string | null } {
  const rawId = readNonEmptyString(data.id);
  if (rawId !== null) {
    const companionServerId = rawId.toLowerCase();
    if (COMPANION_GUID_PATTERN.test(companionServerId) && companionServerId !== ZERO_COMPANION_GUID) {
      return {
        transport: { mode: "relay", companionServerId, ip: "", port: 0 },
        reason: null,
      };
    }
  }

  const ip = readNonEmptyString(data.ip);
  const port = Number(data.port);
  if (ip && Number.isInteger(port) && port >= 1 && port <= 65535) {
    return { transport: { mode: "legacy", ip, port }, reason: null };
  }
  if (rawId !== null) {
    return { transport: { mode: "none" }, reason: "invalid companion server id" };
  }
  return { transport: { mode: "none" }, reason: "missing server id or address" };
}

async function findPairServer(
  db: Database,
  fcmCredentialId: string,
  transport: Exclude<PairTransport, { mode: "none" }>,
) {
  const where =
    transport.mode === "relay"
      ? and(
          eq(rustServers.fcmCredentialId, fcmCredentialId),
          eq(rustServers.companionServerId, transport.companionServerId),
        )
      : and(
          eq(rustServers.fcmCredentialId, fcmCredentialId),
          isNull(rustServers.companionServerId),
          eq(rustServers.ip, transport.ip),
          eq(rustServers.port, transport.port),
        );
  const [server] = await db.select().from(rustServers).where(where).limit(1);
  return server ?? null;
}

function mapEntityType(entityName?: string): EntityType {
  const value = (entityName ?? "").toLowerCase();
  if (value.includes("alarm")) return "smart_alarm";
  if (value.includes("storage")) return "storage_monitor";
  return "smart_switch";
}


export async function handleFcmNotification(
  db: Database,
  rustPlus: RustPlusManager,
  notification: ParsedFcmNotification,
  _notifications: NotificationService,
): Promise<void> {
  const { channelId, body, title, message } = notification;

  if (channelId === "alarm") {
    rustPlus.eventBus.emit({ type: "fcmAlarm", title, message, body });
    return;
  }

  if (channelId !== "pairing") return;

  const data = body as {
    type?: string;
    id?: string;
    ip?: string;
    port?: string | number;
    name?: string;
    playerId?: string;
    playerToken?: string;
    entityId?: string | number;
    entityName?: string;
  };

  const now = new Date();
  const playerId = readCredential(data.playerId);
  const playerToken = readCredential(data.playerToken);
  const { transport, reason } = readPairTransport(data);

  if (data.type === "entity" || data.entityId != null) {
    const entityIdNum = Number(data.entityId);
    if (!Number.isSafeInteger(entityIdNum) || entityIdNum <= 0) {
      console.warn("[FCM] Ignoring entity pair: invalid entity id");
      return;
    }
    if (!playerId || validateRustPlusPlayerId(playerId) !== null) {
      console.warn("[FCM] Ignoring entity pair: invalid player id");
      return;
    }
    if (transport.mode === "none") {
      console.warn(`[FCM] Ignoring entity pair: ${reason}`);
      return;
    }
    // Relay auth identity is a 17-digit Steam ID; check before any pending claim.
    if (transport.mode === "relay" && !/^\d{17}$/.test(playerId)) {
      console.warn("[FCM] Ignoring entity pair: relay player id must be a 17-digit Steam ID");
      return;
    }

    await applySteamLinkFromPair(db, playerId, now);

    const activeFcmId = await requireActiveFcmCredentialId(db);
    if (!activeFcmId) {
      console.warn("[FCM] Entity paired but no active FCM credential");
      return;
    }

    const server = await findPairServer(db, activeFcmId, transport);
    if (!server) {
      console.warn("[FCM] Entity paired but no matching server in DB");
      return;
    }

    const entityName = readNonEmptyString(data.entityName);
    const entityType = mapEntityType(entityName ?? undefined);
    const name = entityName ?? `Entity ${entityIdNum}`;
    const [existing] = await db
      .select()
      .from(rustEntities)
      .where(
        and(
          eq(rustEntities.serverId, server.id),
          eq(rustEntities.entityId, entityIdNum),
        ),
      )
      .limit(1);

    if (!existing) {
      await db.insert(rustEntities).values({
        id: generateId(),
        serverId: server.id,
        entityId: entityIdNum,
        entityType,
        name,
        displayName: null,
        icon: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    rustPlus.handleEntityPaired({
      serverId: server.id,
      entityId: entityIdNum,
      entityType,
      name,
    });

    if (server.isActive) {
      await rustPlus.subscribeEntity(entityIdNum);
    }

    console.log(`[FCM] Paired entity: ${name} (${entityType})`);
    return;
  }

  if (
    !playerId ||
    !playerToken ||
    validateCompanionCredentials(playerId, playerToken) !== null
  ) {
    console.warn("[FCM] Ignoring server pair: invalid player credentials");
    return;
  }

  // Relay auth identity is a 17-digit Steam ID; check before any pending claim.
  if (transport.mode === "relay" && !/^\d{17}$/.test(playerId)) {
    console.warn("[FCM] Ignoring server pair: relay player id must be a 17-digit Steam ID");
    return;
  }

  if (transport.mode === "none") {
    // Never consume a pending master link for a malformed payload. A companion
    // credential link does not need a server address, so it may still proceed.
    if (await findExclusivePendingLinkUser(db, "master")) {
      console.warn(`[FCM] Ignoring server pair: ${reason} (pending master link kept)`);
      return;
    }
    const pendingCompanion = await takeExclusivePendingLinkUser(db, "companion");
    if (pendingCompanion) {
      await applyCompanionLinkFromPair(db, pendingCompanion.id, playerId, playerToken, now);
      console.log(`[FCM] Companion Rust+ linked for user ${pendingCompanion.id}`);
      return;
    }
    console.warn(`[FCM] Ignoring server pair: ${reason}`);
    return;
  }

  const pendingMaster = await takeExclusivePendingLinkUser(db, "master");
  if (pendingMaster) {
    await pairMasterServer(db, rustPlus, data, transport, playerId, playerToken, now);
    return;
  }

  const pendingCompanion = await takeExclusivePendingLinkUser(db, "companion");
  if (pendingCompanion) {
    await applyCompanionLinkFromPair(db, pendingCompanion.id, playerId, playerToken, now);
    console.log(`[FCM] Companion Rust+ linked for user ${pendingCompanion.id}`);
    return;
  }

  if (env.rustplus.allowUnpromptedPair) {
    await pairMasterServer(db, rustPlus, data, transport, playerId, playerToken, now);
    return;
  }

  console.warn(
    "[FCM] Ignoring server pair notification — no exclusive pending master/companion link (start Re-pair Server in Settings)",
  );
}

async function pairMasterServer(
  db: Database,
  rustPlus: RustPlusManager,
  data: { name?: string },
  transport: Exclude<PairTransport, { mode: "none" }>,
  playerId: string,
  playerToken: string,
  now: Date,
): Promise<void> {
  const activeFcmId = await requireActiveFcmCredentialId(db);
  if (!activeFcmId) {
    console.warn("[FCM] Cannot pair server — no active FCM credential");
    return;
  }

  // Relay rows match on slot + GUID; legacy rows only match direct ip:port.
  const where =
    transport.mode === "relay"
      ? and(
          eq(rustServers.fcmCredentialId, activeFcmId),
          eq(rustServers.companionServerId, transport.companionServerId),
        )
      : and(
          eq(rustServers.fcmCredentialId, activeFcmId),
          isNull(rustServers.companionServerId),
          eq(rustServers.ip, transport.ip),
          eq(rustServers.port, transport.port),
        );

  const [existing] = await db.select().from(rustServers).where(where).limit(1);

  const name =
    readNonEmptyString(data.name) ??
    (transport.mode === "relay" ? transport.companionServerId : transport.ip);
  // ponytail: relay rows reuse NOT NULL ip/port with ''/0 sentinels; never dial
  // them. Upgrade path: make ip/port nullable in a future table-rebuild migration.
  const ip = transport.mode === "relay" ? "" : transport.ip;
  const port = transport.mode === "relay" ? 0 : transport.port;
  const companionServerId =
    transport.mode === "relay" ? transport.companionServerId : null;

  let serverId: string;

  await db
    .update(rustServers)
    .set({ isActive: false })
    .where(eq(rustServers.fcmCredentialId, activeFcmId));

  if (existing) {
    serverId = existing.id;
    await db
      .update(rustServers)
      .set({
        name,
        ip,
        port,
        companionServerId,
        playerId,
        playerTokenEncrypted: encrypt(playerToken),
        fcmCredentialId: activeFcmId,
        isActive: true,
        updatedAt: now,
      })
      .where(eq(rustServers.id, existing.id));
    console.log(`[FCM] Updated existing server: ${name}`);
  } else {
    serverId = generateId();
    await db.insert(rustServers).values({
      id: serverId,
      fcmCredentialId: activeFcmId,
      name,
      ip,
      port,
      companionServerId,
      playerId,
      playerTokenEncrypted: encrypt(playerToken),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`[FCM] Paired new server: ${name}`);
  }

  // Persist the pair even when relay auth is missing/expired so importing fresh
  // companion auth does not require re-pairing. Never delete the server here.
  const [saved] = await db
    .select()
    .from(rustServers)
    .where(eq(rustServers.id, serverId))
    .limit(1);

  try {
    const credentials = await reconnectRustServer(db, rustPlus, saved!);
    rustPlus.handleServerPaired(credentials);
  } catch (err) {
    console.warn(
      `[FCM] Server paired and saved, but Rust+ connection is unavailable: ${sanitizeRustPlusError(err)}`,
    );
  }
}
