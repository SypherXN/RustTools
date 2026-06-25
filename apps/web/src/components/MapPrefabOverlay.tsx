import type { MapCoordinateTransform, ProcgenPrefabPoint } from "@rusttools/shared";
import { worldToMapPixel } from "@rusttools/shared";

interface MapPrefabOverlayProps {
  width: number;
  height: number;
  transform: MapCoordinateTransform;
  prefabs: ProcgenPrefabPoint[];
  showCaves: boolean;
  showIcebergs: boolean;
  onSelect?: (prefab: ProcgenPrefabPoint) => void;
}

function procgenCoordToWorld(coord: number, worldSize: number, centered: boolean): number {
  return centered ? coord + worldSize / 2 : coord;
}

export function MapPrefabOverlay({
  width,
  height,
  transform,
  prefabs,
  showCaves,
  showIcebergs,
  onSelect,
}: MapPrefabOverlayProps) {
  const visible = prefabs.filter(
    (p) => (showCaves && p.kind === "cave") || (showIcebergs && p.kind === "iceberg"),
  );
  if (visible.length === 0) return null;
  const centered = visible.some((prefab) => prefab.x < 0 || prefab.z < 0);

  return (
    <svg
      className="map-prefab-overlay"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden
    >
      {visible.map((prefab) => {
        const { x, y } = worldToMapPixel(
          procgenCoordToWorld(prefab.x, transform.worldSize, centered),
          procgenCoordToWorld(prefab.z, transform.worldSize, centered),
          transform,
        );
        const fill = prefab.kind === "iceberg" ? "#7dd3fc" : "#c084fc";
        return (
          <g key={`${prefab.id}-${prefab.x}-${prefab.z}`} className="map-prefab-marker interactive">
            <circle cx={x} cy={y} r={7} fill={fill} opacity={0.9} />
            <circle cx={x} cy={y} r={12} fill="none" stroke={fill} strokeWidth={1.5} opacity={0.6} />
            {onSelect && (
              <circle
                cx={x}
                cy={y}
                r={16}
                fill="transparent"
                className="map-marker-hit"
                onClick={() => onSelect(prefab)}
              />
            )}
            <text x={x} y={y + 20} textAnchor="middle" className="map-prefab-label">
              {prefab.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
