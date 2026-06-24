import { parseSellOrders } from "./vending.js";

export const MARKER_TYPE = {
  PLAYER: 1,
  EXPLOSION: 2,
  VENDING: 3,
  CH47: 4,
  CARGO: 5,
  CRATE: 6,
  GENERIC: 7,
  HELI: 8,
} as const;

export const MARKER_LABELS: Record<number, string> = {
  [MARKER_TYPE.PLAYER]: "Player",
  [MARKER_TYPE.EXPLOSION]: "Explosion",
  [MARKER_TYPE.VENDING]: "Vending",
  [MARKER_TYPE.CH47]: "Chinook",
  [MARKER_TYPE.CARGO]: "Cargo Ship",
  [MARKER_TYPE.CRATE]: "Crate",
  [MARKER_TYPE.GENERIC]: "Marker",
  [MARKER_TYPE.HELI]: "Patrol Heli",
};

export interface ParsedSellOrder {
  item: string;
  itemName: string;
  itemShortname: string;
  quantity: number;
  costItem: string;
  costItemName: string;
  costItemShortname: string;
  costQuantity: number;
}

export interface ParsedMapMarker {
  id: string;
  type: number;
  label: string;
  name: string;
  x: number;
  y: number;
  rotation?: number;
  radius?: number;
  outOfStock?: boolean;
  sellOrderCount?: number;
  sellOrders?: ParsedSellOrder[];
}

export interface ParsedMonument {
  token: string;
  name: string;
  x: number;
  y: number;
}

export function formatMonumentName(token: string): string {
  return token
    .replace(/_display_name$/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function parseMonuments(map: unknown): ParsedMonument[] {
  const data = map as {
    monuments?: Array<{ token?: string; x?: number; y?: number }>;
  };

  return (data.monuments ?? [])
    .filter((m) => m.token && m.x != null && m.y != null)
    .map((m) => ({
      token: m.token!,
      name: formatMonumentName(m.token!),
      x: m.x!,
      y: m.y!,
    }));
}

export function parseMapMarkers(raw: unknown): ParsedMapMarker[] {
  const data = raw as {
    markers?: Array<{
      id?: number;
      type?: number;
      name?: string;
      x?: number;
      y?: number;
      rotation?: number;
      radius?: number;
      outOfStock?: boolean;
      sellOrders?: unknown[];
    }>;
  };

  const results: ParsedMapMarker[] = [];

  for (const marker of data.markers ?? []) {
    if (marker.type == null || marker.x == null || marker.y == null) continue;
    // Team positions come from getTeamInfo; skip duplicate player pings.
    if (marker.type === MARKER_TYPE.PLAYER) continue;

    const type = marker.type;
    const label = MARKER_LABELS[type] ?? "Unknown";
    const name = marker.name?.trim() || label;
    const id = marker.id != null ? `marker-${marker.id}` : `marker-${type}-${marker.x}-${marker.y}`;

    results.push({
      id,
      type,
      label,
      name,
      x: marker.x,
      y: marker.y,
      rotation: marker.rotation,
      radius: marker.radius,
      outOfStock: marker.outOfStock,
      sellOrderCount:
        type === MARKER_TYPE.VENDING ? (marker.sellOrders?.length ?? 0) : undefined,
      sellOrders:
        type === MARKER_TYPE.VENDING
          ? parseSellOrders(marker.sellOrders as Parameters<typeof parseSellOrders>[0])
          : undefined,
    });
  }

  return results;
}

export function isEventMarker(type: number): boolean {
  return (
    type === MARKER_TYPE.EXPLOSION ||
    type === MARKER_TYPE.CH47 ||
    type === MARKER_TYPE.CARGO ||
    type === MARKER_TYPE.CRATE ||
    type === MARKER_TYPE.HELI ||
    type === MARKER_TYPE.GENERIC
  );
}
