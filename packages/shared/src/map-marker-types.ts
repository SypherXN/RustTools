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

export function isConvoyMarker(marker: { type: number; name: string }): boolean {
  if (marker.type === MAP_MARKER_TYPE.GENERIC) {
    return /convoy|armored\s*train/i.test(marker.name);
  }
  return false;
}

export function isBradleyMarker(marker: { type: number; name: string }): boolean {
  if (marker.type === MAP_MARKER_TYPE.GENERIC || marker.type === MAP_MARKER_TYPE.CRATE) {
    return /bradley/i.test(marker.name);
  }
  return false;
}

const SATELLITE_CRASH_TYPES = new Set<number>([
  MAP_MARKER_TYPE.GENERIC,
  MAP_MARKER_TYPE.CRATE,
  MAP_MARKER_TYPE.EXPLOSION,
]);

/**
 * Satellite crash world event (Launch Site terminal). Rust+ has no dedicated
 * marker type — match named GENERIC/CRATE/EXPLOSION. Exclude Satellite Dish.
 */
export function isSatelliteCrashMarker(marker: { type: number; name: string }): boolean {
  if (!SATELLITE_CRASH_TYPES.has(marker.type)) return false;
  const name = marker.name.trim();
  if (!name) return false;
  if (/dish/i.test(name)) return false;
  return (
    /\bsatellite\b/i.test(name) ||
    /satcrash/i.test(name) ||
    /sat(?:ellite)?[\s_-]*crash/i.test(name)
  );
}

/** True when the crash marker looks landed (not the inbound explosion ping). */
export function isGroundedSatelliteCrashMarker(marker: { type: number; name: string }): boolean {
  return isSatelliteCrashMarker(marker) && marker.type !== MAP_MARKER_TYPE.EXPLOSION;
}
