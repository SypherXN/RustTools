import type { MapCoordinateTransform } from "@rusttools/shared";
import {
  automationBaseCircleRadiusPx,
  formatProximityRadiusMeters,
  type ResolvedAutomationBase,
  worldToGridLabel,
  worldToMapPixel,
} from "@rusttools/shared";

interface MapAutomationBaseOverlayProps {
  width: number;
  height: number;
  transform: MapCoordinateTransform;
  base: ResolvedAutomationBase;
}

export function MapAutomationBaseOverlay({
  width,
  height,
  transform,
  base,
}: MapAutomationBaseOverlayProps) {
  const { worldSize } = transform;
  const center = worldToMapPixel(base.x, base.y, transform);
  const radiusPx = automationBaseCircleRadiusPx(base.radiusMeters, transform);
  const gridLabel = worldToGridLabel(base.x, base.y, worldSize);

  return (
    <svg
      className="map-overlay map-automation-base-overlay"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      pointerEvents="none"
    >
      <circle cx={center.x} cy={center.y} r={radiusPx} className="map-automation-base-zone" />
      <circle cx={center.x} cy={center.y} r={8} className="map-automation-base-marker" />
      <circle cx={center.x} cy={center.y} r={3} className="map-automation-base-marker-core" />
      <text x={center.x + 12} y={center.y - 10} className="map-automation-base-label">
        {base.label} · {gridLabel}
        {base.radiusMeters > 0 ? ` (${formatProximityRadiusMeters(base.radiusMeters)})` : ""}
      </text>
    </svg>
  );
}
