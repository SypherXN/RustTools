import type { MapCoordinateTransform, ProcgenPath } from "@rusttools/shared";
import { worldLengthToMapPixels, worldToMapPixel } from "@rusttools/shared";

interface MapPathsOverlayProps {
  width: number;
  height: number;
  transform: MapCoordinateTransform;
  paths: ProcgenPath[];
  visible: boolean;
}

function pathColor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("rail")) return "#94a3b8";
  if (lower.includes("river")) return "#38bdf8";
  if (lower.includes("road")) return "#fbbf24";
  return "#a78bfa";
}

function pathUsesCenteredCoords(paths: ProcgenPath[]): boolean {
  let minCoord = 0;
  for (const path of paths) {
    for (const node of path.nodes) {
      minCoord = Math.min(minCoord, node.x, node.z);
    }
  }
  return minCoord < 0;
}

function procgenPathCoordToWorld(coord: number, worldSize: number, centered: boolean): number {
  return centered ? coord + worldSize / 2 : coord;
}

export function MapPathsOverlay({ width, height, transform, paths, visible }: MapPathsOverlayProps) {
  if (!visible || paths.length === 0) return null;
  const centered = pathUsesCenteredCoords(paths);

  return (
    <svg
      className="map-paths-overlay"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden
    >
      {paths.map((path, index) => {
        if (path.nodes.length < 2) return null;
        const points = path.nodes.map((node) => {
          const { x, y } = worldToMapPixel(
            procgenPathCoordToWorld(node.x, transform.worldSize, centered),
            procgenPathCoordToWorld(node.z, transform.worldSize, centered),
            transform,
          );
          return `${x},${y}`;
        });
        const strokeWidth = Math.max(2.5, worldLengthToMapPixels(path.width, transform) * 0.35);
        return (
          <polyline
            key={`${path.name}-${index}`}
            points={points.join(" ")}
            fill="none"
            stroke={pathColor(path.name)}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}
