import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities, rustServers } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { decrypt } from "../lib/crypto.js";
import { runWithConcurrency } from "../lib/concurrency.js";
import { markEntityValidated } from "../lib/entity-lifecycle.js";
import { checkServerWipe } from "../lib/wipe-tracker.js";

const SUBSCRIBE_CONCURRENCY = 5;

export async function reconnectStoredServers(
  db: Database,
  rustPlus: RustPlusManager,
): Promise<void> {
  const servers = await db.select().from(rustServers).where(eq(rustServers.isActive, true));

  for (const server of servers) {
    try {
      await rustPlus.connectServer({
        id: server.id,
        ip: server.ip,
        port: server.port,
        playerId: server.playerId,
        playerToken: decrypt(server.playerTokenEncrypted),
        name: server.name,
      });
      rustPlus.setActiveServer(server.id);

      const entities = await db
        .select()
        .from(rustEntities)
        .where(eq(rustEntities.serverId, server.id));

      await runWithConcurrency(entities, SUBSCRIBE_CONCURRENCY, async (entity) => {
        try {
          await rustPlus.subscribeEntity(entity.entityId);
          markEntityValidated(server.id, entity.entityId);
        } catch (err) {
          console.error(`[RustPlus] Failed to subscribe entity ${entity.entityId}:`, err);
        }
      });

      try {
        const info = await rustPlus.getServerInfo();
        await checkServerWipe(db, rustPlus, server.id, info);
      } catch (err) {
        console.error(`[RustPlus] Wipe check failed for ${server.name}:`, err);
      }

      console.log(`[RustPlus] Reconnected to server: ${server.name}`);
    } catch (err) {
      console.error(`[RustPlus] Failed to reconnect to ${server.name}:`, err);
    }
  }
}
