import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustServers } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { cleanupServerFilesystem } from "./server-filesystem.js";
import { evictServerRuntimeCaches } from "./server-wipe-cleanup.js";
import { cancelSwitchRevertJobs } from "./switch-scheduler.js";

export class ServerNotFoundError extends Error {
  constructor() {
    super("Server not found");
    this.name = "ServerNotFoundError";
  }
}

/** Disconnect Rust+, remove on-disk assets, and delete the server row (DB cascades related data). */
export async function deleteRustServer(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
): Promise<{ name: string; wasActive: boolean }> {
  const [server] = await db
    .select()
    .from(rustServers)
    .where(eq(rustServers.id, serverId))
    .limit(1);

  if (!server) throw new ServerNotFoundError();

  const wasActive = server.isActive;
  if (wasActive) {
    await rustPlus.disconnectServer(serverId);
  }

  await cancelSwitchRevertJobs(db, rustPlus, { serverId });

  await cleanupServerFilesystem(db, serverId);
  evictServerRuntimeCaches(serverId);
  await db.delete(rustServers).where(eq(rustServers.id, serverId));

  return { name: server.name, wasActive };
}
