import { and, eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { parseTeamRoster, getWorldSize } from "./rust-data.js";
import { getEntitySettings } from "./entity-settings.js";
import { getSwitchState } from "./vending.js";
import { worldToGridLabel } from "@rusttools/shared";

function gridDistance(a: string, b: string): number {
  const parse = (label: string) => {
    const match = label.match(/^([A-Z]+)(\d+)$/i);
    if (!match) return null;
    const col = match[1]!.toUpperCase();
    const row = Number(match[2]);
    let x = 0;
    for (let i = 0; i < col.length; i++) {
      x = x * 26 + (col.charCodeAt(i) - 64);
    }
    return { x: x - 1, y: row - 1 };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return Infinity;
  return Math.max(Math.abs(pa.x - pb.x), Math.abs(pa.y - pb.y));
}

export async function evaluateSwitchAutoModes(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
): Promise<void> {
  const switches = await db
    .select()
    .from(rustEntities)
    .where(and(eq(rustEntities.serverId, serverId), eq(rustEntities.entityType, "smart_switch")));

  if (switches.length === 0) return;

  let isDay = true;
  let teamMembers: Array<{ isOnline?: boolean; x?: number; y?: number }> = [];
  let worldSize = 4000;

  try {
    const [time, team, info] = await Promise.all([
      rustPlus.getTime(),
      rustPlus.getTeamInfo(),
      rustPlus.getServerInfo(),
    ]);
    isDay = (time as { isDay?: boolean }).isDay !== false;
    worldSize = getWorldSize(info) ?? 4000;
    const parsed = parseTeamRoster(team, worldSize);
    teamMembers = parsed.members.map((m) => ({
      isOnline: m.isOnline,
      x: m.x ?? undefined,
      y: m.y ?? undefined,
    }));
  } catch {
    return;
  }

  const anyOnline = teamMembers.some((m) => m.isOnline);

  for (const sw of switches) {
    const settings = await getEntitySettings(db, sw.id);
    const mode = settings.switch?.autoMode;
    if (!mode) continue;

    let desired: boolean | null = null;

    switch (mode) {
      case "auto-day-night":
        desired = !isDay;
        break;
      case "auto-night-day":
        desired = isDay;
        break;
      case "auto-on":
        desired = true;
        break;
      case "auto-off":
        desired = false;
        break;
      case "any-online":
        desired = anyOnline;
        break;
      case "proximity": {
        const radius = settings.switch?.proximityGridRadius ?? 1;
        let switchGrid: string | null = null;
        try {
          const info = (await rustPlus.getEntityInfo(sw.entityId)) as {
            payload?: { x?: number; y?: number };
            x?: number;
            y?: number;
          };
          const x = info.payload?.x ?? info.x;
          const y = info.payload?.y ?? info.y;
          if (x != null && y != null) {
            switchGrid = worldToGridLabel(x, y, worldSize);
          }
        } catch {
          break;
        }
        if (!switchGrid) break;
        desired = teamMembers.some((m) => {
          if (!m.isOnline || m.x == null || m.y == null) return false;
          const grid = worldToGridLabel(m.x, m.y, worldSize);
          return gridDistance(switchGrid!, grid) <= radius;
        });
        break;
      }
    }

    if (desired === null) continue;

    try {
      const current = await getSwitchState(rustPlus, sw.entityId);
      if (current === desired) continue;
      await rustPlus.toggleSwitch(sw.entityId, desired);
    } catch {
      // offline
    }
  }
}
