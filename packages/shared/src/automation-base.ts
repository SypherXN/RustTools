import type { AutomationBaseSettings } from "./notification-settings.js";
import { MAP_GRID_CELL_SIZE } from "./map-grid.js";

export interface AutomationBasePinRef {
  id: string;
  x: number;
  y: number;
  label: string;
}

export interface ProximityRadiusSource {
  radiusMeters?: number | null;
  radiusGrid?: number | null;
}

export interface ResolvedAutomationBase {
  x: number;
  y: number;
  label: string;
  radiusMeters: number;
  mapPinId: string | null;
}

/** Convert legacy grid units to meters. */
export function proximityRadiusMetersFromGrid(radiusGrid: number): number {
  return Math.max(0, radiusGrid) * MAP_GRID_CELL_SIZE;
}

/** Resolve circular proximity radius in world meters. */
export function resolveProximityRadiusMeters(
  source?: ProximityRadiusSource | null,
  fallback?: ProximityRadiusSource | null,
): number {
  if (source?.radiusMeters != null && Number.isFinite(source.radiusMeters) && source.radiusMeters >= 0) {
    return source.radiusMeters;
  }
  if (source?.radiusGrid != null && Number.isFinite(source.radiusGrid)) {
    return proximityRadiusMetersFromGrid(source.radiusGrid);
  }
  if (fallback?.radiusMeters != null && Number.isFinite(fallback.radiusMeters) && fallback.radiusMeters >= 0) {
    return fallback.radiusMeters;
  }
  if (fallback?.radiusGrid != null && Number.isFinite(fallback.radiusGrid)) {
    return proximityRadiusMetersFromGrid(fallback.radiusGrid);
  }
  return MAP_GRID_CELL_SIZE;
}

export function formatProximityRadiusMeters(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "0 m";
  if (meters >= 1000) return `${meters / 1000} km`;
  return `${Math.round(meters)} m`;
}

/** Patch to persist meters only (legacy `radiusGrid` remains readable via resolve). */
export function proximityRadiusPatch(meters: number): { radiusMeters: number } {
  return { radiusMeters: Math.max(0, meters) };
}

/** Resolve server base world coordinates from stored settings and map pins. */
export function resolveAutomationBaseCoords(
  base: AutomationBaseSettings,
  pins: AutomationBasePinRef[],
): ResolvedAutomationBase | null {
  const radiusMeters = resolveProximityRadiusMeters(base);

  if (base.mapPinId) {
    const pin = pins.find((p) => p.id === base.mapPinId);
    if (pin) {
      return {
        x: pin.x,
        y: pin.y,
        label: pin.label,
        radiusMeters,
        mapPinId: pin.id,
      };
    }
  }

  if (base.x != null && base.y != null) {
    return {
      x: base.x,
      y: base.y,
      label: base.label ?? "Base",
      radiusMeters,
      mapPinId: base.mapPinId,
    };
  }

  return null;
}

/** Pixel radius on the map image for a circular world radius. */
export function automationBaseCircleRadiusPx(
  radiusMeters: number,
  transform: { imageWidth: number; oceanMargin: number; worldSize: number },
): number {
  const scale = (transform.imageWidth - transform.oceanMargin * 2) / transform.worldSize;
  return radiusMeters * scale;
}
