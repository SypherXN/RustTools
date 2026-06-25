export const MAP_MARKER_TYPE = {
  PLAYER: 1,
  EXPLOSION: 2,
  VENDING: 3,
  CH47: 4,
  CARGO: 5,
  CRATE: 6,
  GENERIC: 7,
  HELI: 8,
} as const;

export const MAP_MARKER_LABELS: Record<number, string> = {
  [MAP_MARKER_TYPE.PLAYER]: "Player",
  [MAP_MARKER_TYPE.EXPLOSION]: "Explosion",
  [MAP_MARKER_TYPE.VENDING]: "Vending",
  [MAP_MARKER_TYPE.CH47]: "Chinook",
  [MAP_MARKER_TYPE.CARGO]: "Cargo Ship",
  [MAP_MARKER_TYPE.CRATE]: "Crate",
  [MAP_MARKER_TYPE.GENERIC]: "Marker",
  [MAP_MARKER_TYPE.HELI]: "Patrol Heli",
};

export function isTravelingVendorMarker(marker: { type: number; name: string }): boolean {
  if (marker.type === MAP_MARKER_TYPE.GENERIC) {
    return /travel(l)?ing\s*vendor/i.test(marker.name);
  }
  if (marker.type === MAP_MARKER_TYPE.VENDING) {
    return /travel(l)?ing/i.test(marker.name);
  }
  return false;
}
