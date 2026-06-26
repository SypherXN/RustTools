import type { MapLayers, MapMarkerPoint, MapMonument, MapTeamMember } from "../components/MapOverlay";
import { isMapEventMarkerVisible } from "../components/MapOverlay";

/** World-unit radius for treating markers as stacked (e.g. Outpost vending row). */
export const MAP_CLUSTER_TOLERANCE = 18;

export type MarkerSelection =
  | { kind: "vending"; markerId: string }
  | { kind: "monument"; token: string }
  | { kind: "event"; markerId: string }
  | { kind: "team"; steamId: string };

export interface ClusterEntry {
  selection: MarkerSelection;
  label: string;
  typeLabel: string;
}

export type MapSelection =
  | MarkerSelection
  | { kind: "pin"; pinId: string }
  | { kind: "drawing"; drawingId: string }
  | { kind: "pendingPin" }
  | { kind: "pendingDrawing" }
  | { kind: "pendingBase" }
  | { kind: "cluster"; x: number; y: number; items: ClusterEntry[] };

export interface MapClusterContext {
  team: MapTeamMember[];
  markers: MapMarkerPoint[];
  monuments: MapMonument[];
  layers: MapLayers;
}

function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function collectClickable(ctx: MapClusterContext): ClusterEntry[] {
  const items: ClusterEntry[] = [];

  if (ctx.layers.monuments) {
    for (const m of ctx.monuments) {
      items.push({
        selection: { kind: "monument", token: m.token },
        label: m.name,
        typeLabel: "Monument",
      });
    }
  }

  if (ctx.layers.events) {
    for (const m of ctx.markers) {
      if (!isMapEventMarkerVisible(m, ctx.layers)) continue;
      const label = m.name.trim() && m.name !== m.label ? m.name : m.label;
      items.push({
        selection: { kind: "event", markerId: m.id },
        label,
        typeLabel: m.label,
      });
    }
  }

  if (ctx.layers.vending) {
    for (const m of ctx.markers) {
      if (m.type !== 3) continue;
      items.push({
        selection: { kind: "vending", markerId: m.id },
        label: m.name,
        typeLabel: "Vending",
      });
    }
  }

  if (ctx.layers.team) {
    for (const m of ctx.team) {
      if (m.locationKnown === false || m.x == null || m.y == null) continue;
      items.push({
        selection: { kind: "team", steamId: m.steamId },
        label: m.name,
        typeLabel: m.isOnline ? "Team · online" : "Team · offline",
      });
    }
  }

  return items;
}

function coordsForEntry(entry: ClusterEntry, ctx: MapClusterContext): { x: number; y: number } | null {
  const { selection } = entry;
  switch (selection.kind) {
    case "monument": {
      const m = ctx.monuments.find((mon) => mon.token === selection.token);
      return m ? { x: m.x, y: m.y } : null;
    }
    case "vending":
    case "event": {
      const m = ctx.markers.find((marker) => marker.id === selection.markerId);
      return m ? { x: m.x, y: m.y } : null;
    }
    case "team": {
      const m = ctx.team.find((member) => member.steamId === selection.steamId);
      return m?.x != null && m.y != null ? { x: m.x, y: m.y } : null;
    }
  }
}

export function findClusterAt(
  worldX: number,
  worldY: number,
  ctx: MapClusterContext,
  tolerance = MAP_CLUSTER_TOLERANCE,
): ClusterEntry[] {
  const tolSq = tolerance * tolerance;
  const items = collectClickable(ctx);

  return items.filter((entry) => {
    const pos = coordsForEntry(entry, ctx);
    if (!pos) return false;
    return distSq(worldX, worldY, pos.x, pos.y) <= tolSq;
  });
}

export function countClusterAt(
  worldX: number,
  worldY: number,
  ctx: MapClusterContext,
  tolerance = MAP_CLUSTER_TOLERANCE,
): number {
  return findClusterAt(worldX, worldY, ctx, tolerance).length;
}

export function resolveMapSelection(
  worldX: number,
  worldY: number,
  single: MarkerSelection,
  ctx: MapClusterContext,
): MapSelection {
  const cluster = findClusterAt(worldX, worldY, ctx);
  if (cluster.length <= 1) return single;
  return { kind: "cluster", x: worldX, y: worldY, items: cluster };
}
