import { and, eq } from "drizzle-orm";
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
import { takeExclusivePendingLinkUser } from "../lib/rust-link-pending.js";

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
    ip?: string;
    port?: string | number;
    name?: string;
    playerId?: string;
    playerToken?: string;
    entityId?: string | number;
    entityName?: string;
  };

  if (!data.ip || data.port == null || !data.playerId || !data.playerToken) {
    return;
  }

  const port = Number(data.port);
  const playerId = String(data.playerId);
  const playerToken = String(data.playerToken);
  const now = new Date();

  if (data.type === "entity" || data.entityId != null) {
    await applySteamLinkFromPair(db, playerId, now);

    const [server] = await db
      .select()
      .from(rustServers)
      .where(and(eq(rustServers.ip, data.ip), eq(rustServers.port, port)))
      .limit(1);

    if (!server) {
      console.warn("[FCM] Entity paired but no matching server in DB");
      return;
    }

    const entityType = mapEntityType(data.entityName);
    const entityIdNum = Number(data.entityId);
    const name = data.entityName ?? `Entity ${data.entityId}`;

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

  if (data.type === "server" || !data.entityId) {
    const pendingMaster = await takeExclusivePendingLinkUser(db, "master");
    if (pendingMaster) {
      await pairMasterServer(db, rustPlus, data, port, playerId, playerToken, now);
      return;
    }

    const pendingCompanion = await takeExclusivePendingLinkUser(db, "companion");
    if (pendingCompanion) {
      await applyCompanionLinkFromPair(db, pendingCompanion.id, playerId, playerToken, now);
      console.log(`[FCM] Companion Rust+ linked for user ${pendingCompanion.id}`);
      return;
    }

    if (env.rustplus.allowUnpromptedPair) {
      await pairMasterServer(db, rustPlus, data, port, playerId, playerToken, now);
      return;
    }

    console.warn(
      "[FCM] Ignoring server pair notification — no exclusive pending master/companion link (start Re-pair Server in Settings)",
    );
  }
}

async function pairMasterServer(
  db: Database,
  rustPlus: RustPlusManager,
  data: { ip?: string; name?: string },
  port: number,
  playerId: string,
  playerToken: string,
  now: Date,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(rustServers)
    .where(and(eq(rustServers.ip, data.ip!), eq(rustServers.port, port)))
    .limit(1);

  const credentials = {
    ip: data.ip!,
    port,
    playerId,
    playerToken,
    name: data.name ?? data.ip!,
  };

  let serverId: string;

  if (existing) {
    serverId = existing.id;
    await db
      .update(rustServers)
      .set({ isActive: false })
      .where(eq(rustServers.id, existing.id));
    await db
      .update(rustServers)
      .set({
        name: credentials.name,
        playerId: credentials.playerId,
        playerTokenEncrypted: encrypt(credentials.playerToken),
        isActive: true,
        updatedAt: now,
      })
      .where(eq(rustServers.id, existing.id));
    console.log(`[FCM] Updated existing server: ${credentials.name}`);
  } else {
    serverId = generateId();
    await db.update(rustServers).set({ isActive: false });
    await db.insert(rustServers).values({
      id: serverId,
      name: credentials.name,
      ip: credentials.ip,
      port: credentials.port,
      playerId: credentials.playerId,
      playerTokenEncrypted: encrypt(credentials.playerToken),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`[FCM] Paired new server: ${credentials.name}`);
  }

  await rustPlus.connectServer({ id: serverId, ...credentials });
  rustPlus.setActiveServer(serverId);

  rustPlus.handleServerPaired({
    id: serverId,
    ...credentials,
  });
}
