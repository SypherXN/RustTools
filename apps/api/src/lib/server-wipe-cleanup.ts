import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustServers } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { clearAuditLog } from "./data-retention.js";
import { deepSeaTracker } from "./deep-sea-tracker.js";
import { clearPairedDevicesForServer } from "./entity-lifecycle.js";
import { clearMapAnnotationsForServer } from "./map-annotations.js";
import { deleteProcgenMap } from "./procgen-map.js";
import {
  clearAutomationBaseMapPin,
} from "./notification-settings-scrub.js";
import { clearTeamEventLogsForServer } from "./team-event-store.js";
import { clearTeamTrackerState } from "./team-tracker.js";
import { worldEventTracker } from "./world-event-tracker.js";

/** Clear persisted world-event JSON and in-memory tracker state for a server. */
export async function resetWorldEventState(db: Database, serverId: string): Promise<void> {
  await db
    .update(rustServers)
    .set({ worldEventStateJson: null, updatedAt: new Date() })
    .where(eq(rustServers.id, serverId));
  worldEventTracker.reset(serverId);
}

/** Full wipe-scoped cleanup when map seed changes or wipe timer resets sharply. */
export async function applyServerWipeCleanup(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
): Promise<void> {
  await clearTeamEventLogsForServer(db, serverId);
  await clearMapAnnotationsForServer(db, serverId);
  await clearAutomationBaseMapPin(db, serverId);
  await clearPairedDevicesForServer(db, rustPlus, serverId);
  await deleteProcgenMap(db, serverId);
  await resetWorldEventState(db, serverId);
  deepSeaTracker.reset(serverId);
  clearTeamTrackerState(serverId);
  await clearAuditLog(db);
}

/** Evict in-memory runtime caches when a server row is removed. */
export function evictServerRuntimeCaches(serverId: string): void {
  worldEventTracker.reset(serverId);
  deepSeaTracker.reset(serverId);
  clearTeamTrackerState(serverId);
}
