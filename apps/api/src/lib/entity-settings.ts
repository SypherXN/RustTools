import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities } from "@rusttools/db";
import {
  mergeEntityDeviceSettings,
  parseEntityDeviceSettings,
  type EntityDeviceSettings,
} from "@rusttools/shared";

export async function getEntitySettings(
  db: Database,
  entityDbId: string,
): Promise<EntityDeviceSettings> {
  const [row] = await db
    .select({ settingsJson: rustEntities.settingsJson })
    .from(rustEntities)
    .where(eq(rustEntities.id, entityDbId))
    .limit(1);
  return parseEntityDeviceSettings(row?.settingsJson);
}

export async function updateEntitySettings(
  db: Database,
  entityDbId: string,
  patch: Partial<EntityDeviceSettings>,
): Promise<EntityDeviceSettings> {
  const current = await getEntitySettings(db, entityDbId);
  const next = mergeEntityDeviceSettings(current, patch);
  await db
    .update(rustEntities)
    .set({ settingsJson: JSON.stringify(next), updatedAt: new Date() })
    .where(eq(rustEntities.id, entityDbId));
  return next;
}

export function serializeEntitySettings(settings: EntityDeviceSettings): string {
  return JSON.stringify(settings);
}
