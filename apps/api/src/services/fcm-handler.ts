import { and, eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities, rustServers, users } from "@rusttools/db";
import type { EntityType } from "@rusttools/shared";
import type { NotificationService, ParsedFcmNotification, RustPlusManager } from "@rusttools/rustplus-client";
import { encrypt } from "../lib/crypto.js";
import { generateId } from "../lib/ids.js";

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
  const { channelId, body, title, message, playerId } = notification;

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
  const now = new Date();

  if (playerId) {
    await db
      .update(users)
      .set({ steamId: playerId, pendingRustLink: false, updatedAt: now })
      .where(eq(users.pendingRustLink, true));
  }

  if (data.type === "entity" || data.entityId != null) {
    const [server] = await db
      .select()
      .from(rustServers)
      .where(eq(rustServers.ip, data.ip))
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
    const serverId = generateId();
    await db.update(rustServers).set({ isActive: false });
    await db.insert(rustServers).values({
      id: serverId,
      name: data.name ?? data.ip,
      ip: data.ip,
      port,
      playerId: String(data.playerId),
      playerTokenEncrypted: encrypt(String(data.playerToken)),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await rustPlus.connectServer({
      id: serverId,
      ip: data.ip,
      port,
      playerId: String(data.playerId),
      playerToken: String(data.playerToken),
      name: data.name ?? data.ip,
    });

    rustPlus.handleServerPaired({
      id: serverId,
      ip: data.ip,
      port,
      playerId: String(data.playerId),
      playerToken: String(data.playerToken),
      name: data.name ?? data.ip,
    });

    console.log(`[FCM] Paired server: ${data.name ?? data.ip}`);
  }
}
