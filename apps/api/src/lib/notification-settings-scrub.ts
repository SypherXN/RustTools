import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustServers } from "@rusttools/db";
import {
  clearLegacyAutomationEntityRefs,
  mergeNotificationSettings,
  scrubLegacyAutomationsForRemovedRustEntity,
} from "@rusttools/shared";
import { getServerNotificationSettings } from "./server-notification-settings.js";

async function saveServerNotificationSettings(
  db: Database,
  serverId: string,
  settings: Awaited<ReturnType<typeof getServerNotificationSettings>>,
): Promise<void> {
  await db
    .update(rustServers)
    .set({
      notificationSettingsJson: JSON.stringify(settings),
      updatedAt: new Date(),
    })
    .where(eq(rustServers.id, serverId));
}

export async function scrubLegacyAutomationRustEntityRef(
  db: Database,
  serverId: string,
  rustEntityId: number,
): Promise<void> {
  const settings = await getServerNotificationSettings(db, serverId);
  const scrubbed = scrubLegacyAutomationsForRemovedRustEntity(
    settings.legacyAutomations,
    rustEntityId,
  );
  if (!scrubbed) return;

  await saveServerNotificationSettings(
    db,
    serverId,
    mergeNotificationSettings(settings, { legacyAutomations: scrubbed }),
  );
}

export async function clearLegacyAutomationEntityRefsForServer(
  db: Database,
  serverId: string,
): Promise<void> {
  const settings = await getServerNotificationSettings(db, serverId);
  const legacy = clearLegacyAutomationEntityRefs(settings.legacyAutomations);

  await saveServerNotificationSettings(
    db,
    serverId,
    mergeNotificationSettings(settings, { legacyAutomations: legacy }),
  );
}

export async function clearAutomationBaseMapPin(db: Database, serverId: string): Promise<void> {
  const settings = await getServerNotificationSettings(db, serverId);
  if (!settings.automationBase.mapPinId) return;

  await saveServerNotificationSettings(
    db,
    serverId,
    mergeNotificationSettings(settings, { automationBase: { mapPinId: null } }),
  );
}
