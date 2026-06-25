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
): Promise<WorldEventsStatus> {
  await worldEventTracker.ensureLoaded(db, serverId);
  const info = await rustPlus.getServerInfo();
  const settings = await getServerNotificationSettings(db, serverId);
  return worldEventTracker.getStatus(serverId, getWorldSize(info) || 4000, settings.eventTimers);
}
