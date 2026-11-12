import type { MapCoordinateTransform } from "@rusttools/shared";
import { worldToMapPixel } from "@rusttools/shared";
import { useMemo } from "react";
import type { MapClusterContext, MapSelection, MarkerSelection } from "../lib/map-clusters";
import { countClusterAt, resolveMapSelection } from "../lib/map-clusters";

export interface MapTeamMember {
  name: string;
  steamId: string;
  isOnline: boolean;
  locationKnown?: boolean;
  status?: "online" | "afk" | "offline" | "dead";
  x?: number;
  y?: number;
  heading?: number | null;
}

export interface MapMonument {
  token: string;
  name: string;
  x: number;
  y: number;
}

export interface MapLayers {
  team: boolean;
  monuments: boolean;
  grid: boolean;
  /** Server automation base zone (proximity rules). */
  base: boolean;
}

function truncateLabel(name: string, max = 18): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

function toPixel(
  worldX: number,
  worldY: number,
  transform: MapCoordinateTransform,
): { x: number; y: number } {
  return worldToMapPixel(worldX, worldY, transform);
}

function selectionId(selection: MarkerSelection): string {
  switch (selection.kind) {
    case "monument":
      return selection.token;
    case "team":
      return selection.steamId;
  }
}

function isSelected(
  selection: MapSelection | null,
  kind: MarkerSelection["kind"],
  id: string,
): boolean {
  if (!selection) return false;
  if (selection.kind === "cluster") {
    return selection.items.some(
      (item) => item.selection.kind === kind && selectionId(item.selection) === id,
    );
  }
  return selection.kind === kind && selectionId(selection) === id;
}

function stopMapDrag(e: React.PointerEvent | React.MouseEvent) {
  e.stopPropagation();
}

function MapLabel({ x, y, text, className = "map-marker-label" }: { x: number; y: number; text: string; className?: string }) {
  return (
    <text x={x} y={y} className={className} textAnchor="middle" pointerEvents="none">
      {truncateLabel(text)}
    </text>
  );
}

function ClusterBadge({ x, y, count }: { x: number; y: number; count: number }) {
  if (count <= 1) return null;
  return (
    <g className="map-cluster-badge" pointerEvents="none">
      <circle cx={x + 12} cy={y - 12} r={9} />
      <text x={x + 12} y={y - 12} textAnchor="middle" dominantBaseline="central">
        {count}
      </text>
    </g>
  );
}

function HitArea({
  x,
  y,
  r,
  onSelect,
}: {
  x: number;
  y: number;
  r: number;
  onSelect: () => void;
}) {
  return (
    <circle
      cx={x}
      cy={y}
      r={r}
      className="map-marker-hit"
      onPointerDown={stopMapDrag}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    />
  );
}

interface MapOverlayProps {
  width: number;
  height: number;
  transform: MapCoordinateTransform;
  team: MapTeamMember[];
  monuments: MapMonument[];
  layers: MapLayers;
  selection?: MapSelection | null;
  onSelect?: (selection: MapSelection) => void;
}

export function MapOverlay({
  width,
  height,
  transform,
  team,
  monuments,
  layers,
  selection = null,
  onSelect,
}: MapOverlayProps) {
  const teamOnMap = team.filter(
    (m) => m.locationKnown !== false && m.x != null && m.y != null,
  );

  const clusterCtx = useMemo<MapClusterContext>(
    () => ({ team: teamOnMap, monuments, layers }),
    [teamOnMap, monuments, layers],
  );

  const pick = (worldX: number, worldY: number, single: MarkerSelection) => {
    onSelect?.(resolveMapSelection(worldX, worldY, single, clusterCtx));
  };

  return (
    <svg
      className="map-overlay"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
    >
      {layers.monuments &&
        monuments.map((m) => {
          const { x, y } = toPixel(m.x, m.y, transform);
          const selected = isSelected(selection, "monument", m.token);
          const stackCount = countClusterAt(m.x, m.y, clusterCtx);
          return (
            <g
              key={m.token}
              className={`map-marker map-marker-monument${selected ? " selected" : ""}${onSelect ? " interactive" : ""}`}
            >
              <polygon points={`${x},${y - 10} ${x - 8},${y + 8} ${x + 8},${y + 8}`} pointerEvents="none" />
              {onSelect && (
                <HitArea
                  x={x}
                  y={y}
                  r={18}
                  onSelect={() => pick(m.x, m.y, { kind: "monument", token: m.token })}
                />
              )}
              <ClusterBadge x={x} y={y} count={stackCount} />
              <MapLabel x={x} y={y + 22} text={m.name} />
            </g>
          );
        })}

      {layers.team &&
        teamOnMap.map((m) => {
          const { x, y } = toPixel(m.x!, m.y!, transform);
          const statusClass =
            m.status === "afk" ? "afk" : m.status === "dead" ? "offline" : m.isOnline ? "online" : "offline";
          const selected = isSelected(selection, "team", m.steamId);
          const stackCount = countClusterAt(m.x!, m.y!, clusterCtx);
          return (
            <g
              key={m.steamId}
              className={`map-marker map-marker-team map-marker-team-${statusClass}${selected ? " selected" : ""}${onSelect ? " interactive" : ""}`}
            >
              <circle cx={x} cy={y} r={10} className={`map-dot ${statusClass}`} pointerEvents="none" />
              {m.heading != null && Number.isFinite(m.heading) && (
                <line
                  x1={x}
                  y1={y}
                  x2={x + Math.cos((m.heading * Math.PI) / 180) * 16}
                  y2={y - Math.sin((m.heading * Math.PI) / 180) * 16}
                  className="map-team-heading"
                  pointerEvents="none"
                />
              )}
              <circle cx={x} cy={y} r={14} className="map-team-ring" pointerEvents="none" />
              {onSelect && (
                <HitArea
                  x={x}
                  y={y}
                  r={18}
                  onSelect={() => pick(m.x!, m.y!, { kind: "team", steamId: m.steamId })}
                />
              )}
              <ClusterBadge x={x} y={y} count={stackCount} />
              <MapLabel
                x={x}
                y={y + 22}
                text={m.name}
                className={`map-marker-label map-team-label map-team-label-${statusClass}`}
              />
            </g>
          );
        })}
    </svg>
  );
}
