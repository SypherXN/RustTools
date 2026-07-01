import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities, rustServers } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { decrypt } from "../lib/crypto.js";
import { markEntityValidated } from "../lib/entity-lifecycle.js";
import { checkServerWipe } from "../lib/wipe-tracker.js";

function scheduleEntityResubscribe(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
): void {
  void (async () => {
    const entities = await db
      .select()
      .from(rustEntities)
      .where(eq(rustEntities.serverId, serverId));

    for (const entity of entities) {
      try {
        await rustPlus.subscribeEntity(entity.entityId);
        markEntityValidated(serverId, entity.entityId);
      } catch (err) {
        console.error(`[RustPlus] Failed to subscribe entity ${entity.entityId}:`, err);
      }
    }
  })();
}

export async function reconnectRustServer(
  db: Database,
  rustPlus: RustPlusManager,
  server: typeof rustServers.$inferSelect,
): Promise<void> {
  await rustPlus.connectServer({
    id: server.id,
    ip: server.ip,
    port: server.port,
    playerId: server.playerId,
    playerToken: decrypt(server.playerTokenEncrypted),
    name: server.name,
  });
  rustPlus.setActiveServer(server.id);

  try {
    const info = await rustPlus.getServerInfo();
    await checkServerWipe(db, rustPlus, server.id, info);
  } catch (err) {
    console.error(
      `[RustPlus] Startup getInfo failed for ${server.name} — team/map grid labels may use defaults until Rust+ responds:`,
      err instanceof Error ? err.message : err,
    );
  }

  scheduleEntityResubscribe(db, rustPlus, server.id);
}

export async function reconnectStoredServers(
  db: Database,
  rustPlus: RustPlusManager,
): Promise<void> {
  const servers = await db.select().from(rustServers).where(eq(rustServers.isActive, true));

  for (const server of servers) {
    try {
      await reconnectRustServer(db, rustPlus, server);
      console.log(`[RustPlus] Reconnected to server: ${server.name}`);
    } catch (err) {
      console.error(`[RustPlus] Failed to reconnect to ${server.name}:`, err);
    }
  }
}
