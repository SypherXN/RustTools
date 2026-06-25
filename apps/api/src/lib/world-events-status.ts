import type { Database } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import type { WorldEventsStatus } from "@rusttools/shared";
import { getWorldSize } from "./rust-data.js";
import { getServerNotificationSettings } from "./server-notification-settings.js";
import { worldEventTracker } from "./world-event-tracker.js";

export async function fetchWorldEventsStatus(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
  worldSize?: number,
): Promise<WorldEventsStatus> {
  await worldEventTracker.ensureLoaded(db, serverId);
  const resolvedWorldSize =
    worldSize ?? (getWorldSize(await rustPlus.getServerInfo()) || 4000);
  const settings = await getServerNotificationSettings(db, serverId);
  return worldEventTracker.getStatus(serverId, resolvedWorldSize, settings.eventTimers);
}
