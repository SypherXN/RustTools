import type { MapCoordinateTransform } from "@rusttools/shared";
import {
  isBradleyMarker,
  isConvoyMarker,
  isTravelingVendorMarker,
  MAP_MARKER_TYPE,
  worldLengthToMapPixels,
  worldToMapPixel,
} from "@rusttools/shared";
import { useMemo } from "react";
import type { MapClusterContext, MapSelection, MarkerSelection } from "../lib/map-clusters";
import { countClusterAt, resolveMapSelection } from "../lib/map-clusters";

export interface SellOrderListing {
  item: string;
  itemName: string;
  itemShortname: string;
  quantity: number;
  costItem: string;
  costItemName: string;
  costItemShortname: string;
  costQuantity: number;
}

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

export interface MapMarkerPoint {
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
  sellOrders?: SellOrderListing[];
}

export interface MapMonument {
  token: string;
  name: string;
  x: number;
  y: number;
}

export type MapEventTypeKey =
  | "cargo"
  | "heli"
  | "chinook"
  | "vendor"
  | "bradley"
  | "convoy"
  | "crate"
  | "other";

export interface MapEventTypeLayers {
  cargo: boolean;
  heli: boolean;
  chinook: boolean;
  vendor: boolean;
  bradley: boolean;
  convoy: boolean;
  crate: boolean;
  other: boolean;
}

export interface MapLayers {
  team: boolean;
  vending: boolean;
  monuments: boolean;
  events: boolean;
  grid: boolean;
  eventTypes: MapEventTypeLayers;
}

export const DEFAULT_EVENT_TYPE_LAYERS: MapEventTypeLayers = {
  cargo: true,
  heli: true,
  chinook: true,
  vendor: true,
  bradley: true,
  convoy: true,
  crate: true,
  other: true,
};

const EVENT_TYPES = new Set([2, 4, 5, 6, 7, 8]);

export function classifyMapEventMarker(marker: MapMarkerPoint): MapEventTypeKey {
  if (marker.type === MAP_MARKER_TYPE.CARGO) return "cargo";
  if (marker.type === MAP_MARKER_TYPE.HELI) return "heli";
  if (marker.type === MAP_MARKER_TYPE.CH47) return "chinook";
  if (isTravelingVendorMarker(marker)) return "vendor";
  if (isBradleyMarker(marker)) return "bradley";
  if (isConvoyMarker(marker)) return "convoy";
  if (marker.type === MAP_MARKER_TYPE.CRATE) return "crate";
  return "other";
}

export function isMapEventMarkerVisible(marker: MapMarkerPoint, layers: MapLayers): boolean {
  if (!layers.events || !EVENT_TYPES.has(marker.type)) return false;
  return layers.eventTypes[classifyMapEventMarker(marker)];
}

function pointKey(x: number, y: number): string {
  return `${Math.round(x)}:${Math.round(y)}`;
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
    case "vending":
    case "event":
      return selection.markerId;
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
  markers: MapMarkerPoint[];
  monuments: MapMonument[];
  layers: MapLayers;
  highlighted?: Array<{ x: number; y: number }>;
  eventTrails?: {
    cargo: Array<{ x: number; y: number }>;
    heli: Array<{ x: number; y: number }>;
  };
  selection?: MapSelection | null;
  onSelect?: (selection: MapSelection) => void;
}

function renderTrail(
  points: Array<{ x: number; y: number }>,
  transform: MapCoordinateTransform,
  className: string,
) {
  if (points.length < 2) return null;
  const pixelPoints = points.map((point) => toPixel(point.x, point.y, transform));
  const d = pixelPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  return <path d={d} className={className} fill="none" pointerEvents="none" />;
}

export function MapOverlay({
  width,
  height,
  transform,
  team,
  markers,
  monuments,
  layers,
  highlighted = [],
  eventTrails,
  selection = null,
  onSelect,
}: MapOverlayProps) {
  const highlightSet = new Set(highlighted.map((p) => pointKey(p.x, p.y)));

  const teamOnMap = team.filter(
    (m) => m.locationKnown !== false && m.x != null && m.y != null,
  );
  const vendingMarkers = markers.filter((m) => m.type === 3);
  const eventMarkers = markers.filter((m) => isMapEventMarkerVisible(m, layers));

  const clusterCtx = useMemo<MapClusterContext>(
    () => ({ team: teamOnMap, markers, monuments, layers }),
    [teamOnMap, markers, monuments, layers],
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
      {layers.events && layers.eventTypes.cargo && eventTrails?.cargo?.length
        ? renderTrail(eventTrails.cargo, transform, "map-event-trail map-event-trail-cargo")
        : null}
      {layers.events && layers.eventTypes.heli && eventTrails?.heli?.length
        ? renderTrail(eventTrails.heli, transform, "map-event-trail map-event-trail-heli")
        : null}

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

      {eventMarkers.map((m) => {
          const { x, y } = toPixel(m.x, m.y, transform);
          const className = `map-marker map-marker-event map-marker-type-${m.type}${isSelected(selection, "event", m.id) ? " selected" : ""}${onSelect ? " interactive" : ""}`;
          const radiusPx =
            m.type === 7 && m.radius
              ? worldLengthToMapPixels(m.radius, transform)
              : undefined;
          const displayName = m.name.trim() && m.name !== m.label ? m.name : m.label;
          const stackCount = countClusterAt(m.x, m.y, clusterCtx);
          return (
            <g key={m.id} className={className}>
              {radiusPx ? (
                <circle cx={x} cy={y} r={radiusPx} className="map-marker-radius" pointerEvents="none" />
              ) : (
                <rect x={x - 7} y={y - 7} width={14} height={14} rx={2} pointerEvents="none" />
              )}
              {onSelect && (
                <HitArea
                  x={x}
                  y={y}
                  r={radiusPx ? radiusPx + 8 : 18}
                  onSelect={() => pick(m.x, m.y, { kind: "event", markerId: m.id })}
                />
              )}
              <ClusterBadge x={x} y={y} count={stackCount} />
              <MapLabel x={x} y={y + 22} text={displayName} />
            </g>
          );
        })}

      {layers.vending &&
        vendingMarkers.map((m) => {
          const { x, y } = toPixel(m.x, m.y, transform);
          const highlightedMarker = highlightSet.has(pointKey(m.x, m.y));
          const selected = isSelected(selection, "vending", m.id);
          const stackCount = countClusterAt(m.x, m.y, clusterCtx);
          return (
            <g
              key={m.id}
              className={`map-marker map-marker-vending${highlightedMarker ? " highlighted" : ""}${selected ? " selected" : ""}${m.outOfStock ? " out-of-stock" : ""}${onSelect ? " interactive" : ""}`}
            >
              {highlightedMarker && (
                <circle cx={x} cy={y} r={16} className="map-marker-highlight-ring" pointerEvents="none" />
              )}
              <rect x={x - 8} y={y - 8} width={16} height={16} rx={3} pointerEvents="none" />
              {onSelect && (
                <HitArea
                  x={x}
                  y={y}
                  r={18}
                  onSelect={() => pick(m.x, m.y, { kind: "vending", markerId: m.id })}
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
