import type { Database } from "@rusttools/db";
import { clearMapAnnotationsForServer } from "./map-annotations.js";
import { removeProcgenServerDir } from "./procgen-map.js";

/** Remove on-disk assets tied to a server before its DB row is deleted. */
export async function cleanupServerFilesystem(db: Database, serverId: string): Promise<void> {
  await removeProcgenServerDir(serverId);
  await clearMapAnnotationsForServer(db, serverId);
}
