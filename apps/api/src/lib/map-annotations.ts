import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { mapDrawings, mapPins } from "@rusttools/db";
import { deleteAutomationRulesReferencingMapPin } from "./automation-rule-cleanup.js";
import { deletePinScreenshotIfExists } from "./map-pin-storage.js";

export { deletePinScreenshotIfExists } from "./map-pin-storage.js";

/** Clear map drawings, pins, and all pin screenshot files for a server. */
export async function clearMapAnnotationsForServer(db: Database, serverId: string): Promise<void> {
  const pins = await db
    .select({ id: mapPins.id, screenshotPath: mapPins.screenshotPath })
    .from(mapPins)
    .where(eq(mapPins.serverId, serverId));

  for (const pin of pins) {
    if (pin.screenshotPath) {
      deletePinScreenshotIfExists(pin.screenshotPath);
    } else {
      deletePinScreenshotIfExists(pin.id);
    }
    await deleteAutomationRulesReferencingMapPin(db, serverId, pin.id);
  }

  await db.delete(mapDrawings).where(eq(mapDrawings.serverId, serverId));
  await db.delete(mapPins).where(eq(mapPins.serverId, serverId));
}
