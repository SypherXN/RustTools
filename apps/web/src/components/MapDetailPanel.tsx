import type { ReactNode } from "react";
import { formatMonumentRecyclers, getCctvForMonument, getMonumentInfo, rustItemIconUrl, worldToGridLabel } from "@rusttools/shared";
import type { MapPin, MapOverlaysResponse } from "@rusttools/shared";
import { apiFetch, apiUpload } from "../lib/api";
import type { MapSelection } from "../lib/map-clusters";
import type { MapMarkerPoint, MapMonument, MapTeamMember } from "./MapOverlay";

export type { MapSelection } from "../lib/map-clusters";

export interface SellOrderListing {
  itemName: string;
  itemShortname: string;
  quantity: number;
  costItemName: string;
  costItemShortname: string;
  costQuantity: number;
}


interface MapDetailPanelProps {
  selection: MapSelection | null;
  markers: MapMarkerPoint[];
  monuments: MapMonument[];
  team: MapTeamMember[];
  pins: MapPin[];
  worldSize: number;
  onClose: () => void;
  onSelect?: (selection: MapSelection) => void;
  onFollowTeam?: (steamId: string) => void;
  followingSteamId?: string | null;
  canEditPins?: boolean;
  onPinUpdated?: (pin: MapPin) => void;
}

function formatCoords(x: number, y: number, worldSize: number): string {
  const grid = worldToGridLabel(x, y, worldSize);
  return `${grid} (${Math.round(x)}, ${Math.round(y)})`;
}

function VendingDetails({
  marker,
  worldSize,
}: {
  marker: MapMarkerPoint;
  worldSize: number;
}) {
  const orders = marker.sellOrders ?? [];
  return (
    <>
      <p className="map-detail-meta">
        {formatCoords(marker.x, marker.y, worldSize)}
        {marker.outOfStock ? " · Out of stock" : ""}
      </p>
      {orders.length === 0 ? (
        <p className="muted">No listings available.</p>
      ) : (
        <ul className="map-detail-trades">
          {orders.map((order, i) => (
            <li
              key={`${order.itemShortname}-${order.costItemShortname}-${i}`}
              className="map-vending-trade"
              title={`${order.itemName} ×${order.quantity} for ${order.costQuantity} ${order.costItemName}`}
            >
              <div className="map-vending-trade-side">
                <img
                  className="map-vending-trade-icon"
                  src={rustItemIconUrl(order.itemShortname)}
                  alt=""
                  loading="lazy"
                />
                <div className="map-vending-trade-meta">
                  <span className="map-vending-trade-name">{order.itemName}</span>
                  <span className="map-vending-trade-qty">×{order.quantity.toLocaleString()}</span>
                </div>
              </div>
              <span className="map-vending-trade-arrow" aria-hidden>
                →
              </span>
              <div className="map-vending-trade-side map-vending-trade-side-cost">
                <img
                  className="map-vending-trade-icon"
                  src={rustItemIconUrl(order.costItemShortname)}
                  alt=""
                  loading="lazy"
                />
                <div className="map-vending-trade-meta">
                  <span className="map-vending-trade-name">{order.costItemName}</span>
                  <span className="map-vending-trade-qty">×{order.costQuantity.toLocaleString()}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function MonumentDetails({
  monument,
  worldSize,
}: {
  monument: MapMonument;
  worldSize: number;
}) {
  const info = getMonumentInfo(monument.token);

  const facts: Array<{ label: string; value: string }> = [
    { label: "Radiation", value: info.radiation },
    { label: "Loot reset", value: info.lootReset },
    { label: "Recycler", value: formatMonumentRecyclers(info.recyclers) },
  ];

  if (info.keycards) facts.push({ label: "Keycards", value: info.keycards });
  if (info.workbench) facts.push({ label: "Workbench", value: info.workbench });
  if (info.scientists) facts.push({ label: "Scientists", value: info.scientists });

  const cctv = getCctvForMonument(monument.token) ?? getCctvForMonument(monument.name);

  return (
    <>
      <p className="map-detail-category">{info.category}</p>
      <p className="map-detail-meta">{formatCoords(monument.x, monument.y, worldSize)}</p>
      <p>{info.description}</p>
      <dl className="map-detail-facts">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {cctv && (
        <>
          <h4>CCTV codes</h4>
          {cctv.dynamic && (
            <p className="muted">Dynamic codes — suffix varies per wipe; check in-game terminal.</p>
          )}
          <ul className="map-detail-cctv">
            {cctv.codes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      {info.notes.length > 0 && (
        <>
          <h4>Notes</h4>
          <ul className="map-detail-notes">
            {info.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      )}
      <p className="muted map-detail-disclaimer">
        Reference info — reset times and radiation vary by server and game updates.
      </p>
    </>
  );
}

function EventDetails({
  marker,
  worldSize,
}: {
  marker: MapMarkerPoint;
  worldSize: number;
}) {
  return (
    <>
      <p className="map-detail-category">{marker.label}</p>
      <p className="map-detail-meta">{formatCoords(marker.x, marker.y, worldSize)}</p>
      {marker.radius != null && marker.radius > 0 && (
        <p>Radius: {Math.round(marker.radius)}m</p>
      )}
      {marker.rotation != null && <p>Heading: {Math.round(marker.rotation)}°</p>}
      <p className="muted">Live world event — position updates on refresh.</p>
    </>
  );
}

function TeamDetails({
  member,
  worldSize,
  onFollow,
  following,
}: {
  member: MapTeamMember;
  worldSize: number;
  onFollow?: (steamId: string) => void;
  following?: boolean;
}) {
  const hasLocation = member.locationKnown !== false && member.x != null && member.y != null;
  return (
    <>
      <p className="map-detail-meta">
        <span className={member.isOnline ? "dot online" : "dot offline"} />
        {member.isOnline ? "Online" : "Offline"}
      </p>
      {hasLocation ? (
        <p>{formatCoords(member.x!, member.y!, worldSize)}</p>
      ) : (
        <p className="muted">Location unknown</p>
      )}
      {hasLocation && onFollow && (
        <button type="button" className="btn-secondary" onClick={() => onFollow(member.steamId)}>
          {following ? "Following" : "Follow on map"}
        </button>
      )}
      <p className="muted map-detail-steam">Steam ID: {member.steamId}</p>
    </>
  );
}

function PinDetails({
  pin,
  worldSize,
  canEdit,
  onUpdated,
}: {
  pin: MapPin;
  worldSize: number;
  canEdit?: boolean;
  onUpdated?: (pin: MapPin) => void;
}) {
  const API_BASE = import.meta.env.VITE_API_URL ?? "/api";
  return (
    <>
      <p className="map-detail-meta">{formatCoords(pin.x, pin.y, worldSize)}</p>
      {pin.notes && <p>{pin.notes}</p>}
      {pin.screenshotUrl && (
        <img
          className="map-pin-screenshot"
          src={`${API_BASE}${pin.screenshotUrl}`}
          alt={`Screenshot for ${pin.label}`}
          loading="lazy"
        />
      )}
      {canEdit && (
        <label className="map-pin-upload">
          {pin.screenshotUrl ? "Replace screenshot" : "Add screenshot"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const form = new FormData();
              form.append("file", file);
              void apiUpload<{ ok: boolean; screenshotUrl: string }>(
                `/servers/active/map/pins/${pin.id}/screenshot`,
                form,
              ).then(() =>
                apiFetch<MapOverlaysResponse>(`/servers/active/map/overlays`).then((o) => {
                  const updated = o.pins.find((p) => p.id === pin.id);
                  if (updated) onUpdated?.(updated);
                }),
              );
              e.target.value = "";
            }}
          />
        </label>
      )}
      <p className="muted">Added by {pin.createdBy}</p>
    </>
  );
}

function ClusterDetails({
  selection,
  worldSize,
  onSelect,
}: {
  selection: Extract<MapSelection, { kind: "cluster" }>;
  worldSize: number;
  onSelect?: (selection: MapSelection) => void;
}) {
  return (
    <>
      <p className="map-detail-meta">{formatCoords(selection.x, selection.y, worldSize)}</p>
      <p className="muted">{selection.items.length} markers stacked here — pick one:</p>
      <ul className="map-cluster-list">
        {selection.items.map((item) => (
          <li key={`${item.selection.kind}-${JSON.stringify(item.selection)}`}>
            <button
              type="button"
              className="map-cluster-item"
              onClick={() => onSelect?.(item.selection)}
            >
              <span className="map-cluster-type">{item.typeLabel}</span>
              <span className="map-cluster-label">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function MapDetailPanel({
  selection,
  markers,
  monuments,
  team,
  pins,
  worldSize,
  onClose,
  onSelect,
  onFollowTeam,
  followingSteamId,
  canEditPins,
  onPinUpdated,
}: MapDetailPanelProps) {
  if (!selection) {
    return (
      <aside className="map-detail-panel map-detail-panel-empty">
        <h2>Details</h2>
        <p className="muted">Click a vending machine, monument, event, or teammate on the map.</p>
      </aside>
    );
  }

  let title = "Details";
  let body: ReactNode = null;

  if (selection.kind === "vending") {
    const marker = markers.find((m) => m.id === selection.markerId);
    if (!marker) {
      body = <p className="muted">Vending machine no longer on map.</p>;
    } else {
      title = marker.name;
      body = <VendingDetails marker={marker} worldSize={worldSize} />;
    }
  } else if (selection.kind === "monument") {
    const monument = monuments.find((m) => m.token === selection.token);
    if (!monument) {
      body = <p className="muted">Monument not found.</p>;
    } else {
      title = monument.name;
      body = <MonumentDetails monument={monument} worldSize={worldSize} />;
    }
  } else if (selection.kind === "event") {
    const marker = markers.find((m) => m.id === selection.markerId);
    if (!marker) {
      body = <p className="muted">Event no longer on map.</p>;
    } else {
      title = marker.name.trim() || marker.label;
      body = <EventDetails marker={marker} worldSize={worldSize} />;
    }
  } else if (selection.kind === "team") {
    const member = team.find((m) => m.steamId === selection.steamId);
    if (!member) {
      body = <p className="muted">Teammate not found.</p>;
    } else {
      title = member.name;
      body = (
        <TeamDetails
          member={member}
          worldSize={worldSize}
          onFollow={onFollowTeam}
          following={followingSteamId === member.steamId}
        />
      );
    }
  } else if (selection.kind === "pin") {
    const pin = pins.find((p) => p.id === selection.pinId);
    if (!pin) {
      body = <p className="muted">Pin not found.</p>;
    } else {
      title = pin.label;
      body = <PinDetails pin={pin} worldSize={worldSize} canEdit={canEditPins} onUpdated={onPinUpdated} />;
    }
  } else if (selection.kind === "cluster") {
    title = `${selection.items.length} markers`;
    body = <ClusterDetails selection={selection} worldSize={worldSize} onSelect={onSelect} />;
  }

  return (
    <aside className="map-detail-panel">
      <div className="map-detail-header">
        <h2>{title}</h2>
        <button type="button" className="btn-secondary map-detail-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="map-detail-body">{body}</div>
    </aside>
  );
}
