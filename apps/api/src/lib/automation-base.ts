import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { mapPins } from "@rusttools/db";
import type { AutomationBaseSettings, AutomationCondition, AutomationTrigger } from "@rusttools/shared";
import { resolveProximityRadiusMeters } from "@rusttools/shared";

export interface ResolvedAutomationPoint {
  x: number;
  y: number;
  radiusMeters: number;
}

type PointSource = Pick<
  AutomationCondition,
  "baseX" | "baseY" | "radiusMeters" | "radiusGrid" | "useServerBase" | "mapPinId"
> &
  Pick<AutomationTrigger, "baseX" | "baseY" | "radiusMeters" | "radiusGrid" | "useServerBase" | "mapPinId">;

export async function resolveAutomationPoint(
  db: Database,
  serverId: string,
  serverBase: AutomationBaseSettings,
  source: PointSource,
): Promise<ResolvedAutomationPoint | null> {
  const radiusMeters = resolveProximityRadiusMeters(source, serverBase);

  if (source.mapPinId) {
    const [pin] = await db
      .select()
      .from(mapPins)
      .where(eq(mapPins.id, source.mapPinId))
      .limit(1);
    if (pin && pin.serverId === serverId) {
      return { x: pin.x, y: pin.y, radiusMeters };
    }
  }

  if (source.baseX != null && source.baseY != null) {
    return { x: source.baseX, y: source.baseY, radiusMeters };
  }

  if (source.useServerBase !== false && serverBase.mapPinId) {
    const [pin] = await db
      .select()
      .from(mapPins)
      .where(eq(mapPins.id, serverBase.mapPinId))
      .limit(1);
    if (pin && pin.serverId === serverId) {
      return { x: pin.x, y: pin.y, radiusMeters };
    }
  }

  if (source.useServerBase !== false && serverBase.x != null && serverBase.y != null) {
    return { x: serverBase.x, y: serverBase.y, radiusMeters };
  }

  return null;
}
