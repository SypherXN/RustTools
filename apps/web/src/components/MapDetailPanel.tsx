import { useState, type ReactNode } from "react";
import { formatMonumentRecyclers, formatProximityRadiusMeters, getCctvForMonument, getMonumentInfo, worldToGridLabel } from "@rusttools/shared";
import { VendingTradeRow } from "./VendingTradeRow";
import type { MapDrawingPoint, MapDrawingStroke, MapPin, MapOverlaysResponse } from "@rusttools/shared";
import { MAP_DRAWING_COLORS } from "@rusttools/shared";
import { apiFetch, apiUpload } from "../lib/api";
import { useAuthenticatedImageSrc } from "../hooks/useAuthenticatedImageSrc";
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
  drawings: MapDrawingStroke[];
  worldSize: number;
  onClose: () => void;
  onSelect?: (selection: MapSelection) => void;
  onFollowTeam?: (steamId: string) => void;
  followingSteamId?: string | null;
  canEditPins?: boolean;
  onPinUpdated?: (pin: MapPin) => void;
  onPinDeleted?: (pinId: string) => void;
  onDrawingUpdated?: (drawing: MapDrawingStroke) => void;
  onDrawingDeleted?: (drawingId: string) => void;
  pendingPin?: { x: number; y: number } | null;
  pendingDrawing?: { points: MapDrawingPoint[] } | null;
  pendingDrawingColor?: string;
  onPendingDrawingColorChange?: (color: string) => void;
  onPendingPinSave?: (label: string, notes: string) => void;
  onPendingPinDiscard?: () => void;
  onPendingDrawingSave?: (label: string, color: string) => void;
  onPendingDrawingDiscard?: () => void;
  canSetServerBase?: boolean;
  serverBasePinId?: string | null;
  onSetServerBaseFromPin?: (pin: MapPin) => void;
  pendingBasePoint?: { x: number; y: number } | null;
  serverBaseRadiusMeters?: number;
  onConfirmPendingBase?: (label: string, radiusMeters: number) => void;
  onDiscardPendingBase?: () => void;
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
            <li key={`${order.itemShortname}-${order.costItemShortname}-${i}`}>
              <VendingTradeRow order={order} />
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
  onDeleted,
  isServerBase,
  canSetServerBase,
  onSetAsServerBase,
}: {
  pin: MapPin;
  worldSize: number;
  canEdit?: boolean;
  onUpdated?: (pin: MapPin) => void;
  onDeleted?: (pinId: string) => void;
  isServerBase?: boolean;
  canSetServerBase?: boolean;
  onSetAsServerBase?: (pin: MapPin) => void;
}) {
  const screenshotSrc = useAuthenticatedImageSrc(pin.screenshotUrl);
  return (
    <>
      <p className="map-detail-meta">{formatCoords(pin.x, pin.y, worldSize)}</p>
      {isServerBase && <p className="map-detail-badge">Server automation base</p>}
      {pin.notes && <p>{pin.notes}</p>}
      {screenshotSrc && (
        <img
          className="map-pin-screenshot"
          src={screenshotSrc}
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
      {canSetServerBase && onSetAsServerBase && !isServerBase && (
        <button type="button" className="btn-primary" onClick={() => onSetAsServerBase(pin)}>
          Set as server base
        </button>
      )}
      {canEdit && onDeleted && (
        <button
          type="button"
          className="btn-secondary map-pin-delete"
          onClick={() => {
            if (window.confirm(`Delete pin "${pin.label}"?`)) {
              onDeleted(pin.id);
            }
          }}
        >
          Delete pin
        </button>
      )}
      <p className="muted">Added by {pin.createdBy}</p>
    </>
  );
}

function DrawingColorPicker({
  color,
  onChange,
}: {
  color: string;
  onChange: (color: string) => void;
}) {
  return (
    <fieldset className="map-drawing-colors">
      <legend>Color</legend>
      <div className="map-drawing-color-row">
        {MAP_DRAWING_COLORS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`map-drawing-color-swatch${color === option.value ? " active" : ""}`}
            style={{ background: option.value }}
            title={option.name}
            aria-label={option.name}
            aria-pressed={color === option.value}
            onClick={() => onChange(option.value)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function PendingBaseConfirm({
  point,
  worldSize,
  defaultRadiusMeters,
  onSave,
  onDiscard,
}: {
  point: { x: number; y: number };
  worldSize: number;
  defaultRadiusMeters: number;
  onSave: (label: string, radiusMeters: number) => void;
  onDiscard: () => void;
}) {
  const [label, setLabel] = useState("Base");
  const [radiusMeters, setRadiusMeters] = useState(defaultRadiusMeters);

  return (
    <>
      <p className="map-detail-meta">{formatCoords(point.x, point.y, worldSize)}</p>
      <label>
        Label
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Base" />
      </label>
      <label>
        Proximity radius (m)
        <input
          type="number"
          min={0}
          max={10000}
          step={1}
          value={radiusMeters}
          onChange={(e) => setRadiusMeters(Math.max(0, Number(e.target.value) || 0))}
        />
        <span className="muted">
          Circular distance for automation rules ({formatProximityRadiusMeters(radiusMeters)}).
        </span>
      </label>
      <div className="map-detail-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={() => onSave(label.trim() || "Base", radiusMeters)}
        >
          Save server base
        </button>
        <button type="button" className="btn-secondary" onClick={onDiscard}>
          Cancel
        </button>
      </div>
    </>
  );
}

function PendingPinCreate({
  point,
  worldSize,
  onSave,
  onDiscard,
}: {
  point: { x: number; y: number };
  worldSize: number;
  onSave: (label: string, notes: string) => void;
  onDiscard: () => void;
}) {
  const [label, setLabel] = useState("Base");
  const [notes, setNotes] = useState("");

  return (
    <>
      <p className="map-detail-meta">{formatCoords(point.x, point.y, worldSize)}</p>
      <label>
        Label
        <input
          value={label}
          autoFocus
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && label.trim()) onSave(label.trim(), notes.trim());
            if (e.key === "Escape") onDiscard();
          }}
        />
      </label>
      <label>
        Notes <span className="muted">(optional)</span>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && label.trim()) onSave(label.trim(), notes.trim());
            if (e.key === "Escape") onDiscard();
          }}
        />
      </label>
      <div className="map-detail-actions">
        <button type="button" className="btn-secondary" onClick={onDiscard}>
          Discard
        </button>
        <button type="button" disabled={!label.trim()} onClick={() => onSave(label.trim(), notes.trim())}>
          Place pin
        </button>
      </div>
    </>
  );
}

function PendingDrawingCreate({
  points,
  worldSize,
  color,
  onColorChange,
  onSave,
  onDiscard,
}: {
  points: MapDrawingPoint[];
  worldSize: number;
  color: string;
  onColorChange: (color: string) => void;
  onSave: (label: string, color: string) => void;
  onDiscard: () => void;
}) {
  const [label, setLabel] = useState("");
  const start = points[0];

  return (
    <>
      <p className="map-detail-meta">
        {start ? formatCoords(start.x, start.y, worldSize) : "—"}
        <span className="muted"> · {points.length} points</span>
      </p>
      <label>
        Name <span className="muted">(optional)</span>
        <input
          value={label}
          autoFocus
          placeholder="e.g. Raid path"
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave(label.trim(), color);
            if (e.key === "Escape") onDiscard();
          }}
        />
      </label>
      <DrawingColorPicker color={color} onChange={onColorChange} />
      <div className="map-detail-actions">
        <button type="button" className="btn-secondary" onClick={onDiscard}>
          Discard
        </button>
        <button type="button" onClick={() => onSave(label.trim(), color)}>
          Save drawing
        </button>
      </div>
    </>
  );
}

function DrawingDetails({
  drawing,
  worldSize,
  canEdit,
  onUpdated,
  onDeleted,
}: {
  drawing: MapDrawingStroke;
  worldSize: number;
  canEdit?: boolean;
  onUpdated?: (drawing: MapDrawingStroke) => void;
  onDeleted?: (drawingId: string) => void;
}) {
  const [label, setLabel] = useState(drawing.label);
  const [color, setColor] = useState(drawing.color);
  const start = drawing.points[0];

  const save = async () => {
    const updated = await apiFetch<MapDrawingStroke>(`/servers/active/map/drawings/${drawing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ label: label.trim(), color }),
    });
    onUpdated?.(updated);
  };

  return (
    <>
      <p className="map-detail-meta">
        {start ? formatCoords(start.x, start.y, worldSize) : "—"}
        <span className="muted"> · {drawing.points.length} points</span>
      </p>
      {canEdit ? (
        <>
          <label>
            Name
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <fieldset className="map-drawing-colors">
            <legend>Color</legend>
            <div className="map-drawing-color-row">
              {MAP_DRAWING_COLORS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`map-drawing-color-swatch${color === option.value ? " active" : ""}`}
                  style={{ background: option.value }}
                  title={option.name}
                  aria-label={option.name}
                  aria-pressed={color === option.value}
                  onClick={() => setColor(option.value)}
                />
              ))}
            </div>
          </fieldset>
          <button type="button" onClick={() => void save()}>
            Save changes
          </button>
          {onDeleted && (
            <button
              type="button"
              className="btn-secondary map-pin-delete"
              onClick={() => {
                if (window.confirm("Delete this drawing?")) {
                  onDeleted(drawing.id);
                }
              }}
            >
              Delete drawing
            </button>
          )}
        </>
      ) : (
        <>
          {drawing.label && <p>{drawing.label}</p>}
          <p className="muted">
            Color: <span className="map-drawing-color-preview" style={{ background: drawing.color }} />
          </p>
        </>
      )}
      <p className="muted">Added by {drawing.createdBy}</p>
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
  drawings,
  worldSize,
  onClose,
  onSelect,
  onFollowTeam,
  followingSteamId,
  canEditPins,
  onPinUpdated,
  onPinDeleted,
  onDrawingUpdated,
  onDrawingDeleted,
  pendingPin,
  pendingDrawing,
  pendingDrawingColor = MAP_DRAWING_COLORS[0].value,
  onPendingDrawingColorChange,
  onPendingPinSave,
  onPendingPinDiscard,
  onPendingDrawingSave,
  onPendingDrawingDiscard,
  canSetServerBase,
  serverBasePinId,
  onSetServerBaseFromPin,
  pendingBasePoint,
  serverBaseRadiusMeters = 150,
  onConfirmPendingBase,
  onDiscardPendingBase,
}: MapDetailPanelProps) {
  if (!selection) {
    return (
      <aside className="map-detail-panel map-detail-panel-empty">
        <h2>Details</h2>
        <p className="muted">
          Click a vending machine, monument, event, teammate, or team pin on the map. Use{" "}
          <strong>Annotate</strong> to draw or place pins — name and color them in this panel.
          {canSetServerBase && (
            <>
              {" "}
              Admins can use <strong>Set server base</strong> to link automation proximity rules to a map
              location.
            </>
          )}
        </p>
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
      body = (
        <PinDetails
          pin={pin}
          worldSize={worldSize}
          canEdit={canEditPins}
          onUpdated={onPinUpdated}
          onDeleted={onPinDeleted}
          isServerBase={serverBasePinId === pin.id}
          canSetServerBase={canSetServerBase}
          onSetAsServerBase={onSetServerBaseFromPin}
        />
      );
    }
  } else if (selection.kind === "drawing") {
    const drawing = drawings.find((d) => d.id === selection.drawingId);
    if (!drawing) {
      body = <p className="muted">Drawing not found.</p>;
    } else {
      title = drawing.label || "Drawing";
      body = (
        <DrawingDetails
          drawing={drawing}
          worldSize={worldSize}
          canEdit={canEditPins}
          onUpdated={onDrawingUpdated}
          onDeleted={onDrawingDeleted}
        />
      );
    }
  } else if (selection.kind === "pendingPin") {
    if (!pendingPin) {
      body = <p className="muted">Pin placement cancelled.</p>;
    } else {
      title = "New pin";
      body = (
        <PendingPinCreate
          point={pendingPin}
          worldSize={worldSize}
          onSave={(label, notes) => onPendingPinSave?.(label, notes)}
          onDiscard={() => onPendingPinDiscard?.()}
        />
      );
    }
  } else if (selection.kind === "pendingDrawing") {
    if (!pendingDrawing) {
      body = <p className="muted">Drawing discarded.</p>;
    } else {
      title = "New drawing";
      body = (
        <PendingDrawingCreate
          points={pendingDrawing.points}
          worldSize={worldSize}
          color={pendingDrawingColor}
          onColorChange={(color) => onPendingDrawingColorChange?.(color)}
          onSave={(label, color) => onPendingDrawingSave?.(label, color)}
          onDiscard={() => onPendingDrawingDiscard?.()}
        />
      );
    }
  } else if (selection.kind === "pendingBase") {
    if (!pendingBasePoint) {
      body = <p className="muted">Base placement cancelled.</p>;
    } else {
      title = "Server base";
      body = (
        <PendingBaseConfirm
          point={pendingBasePoint}
          worldSize={worldSize}
          defaultRadiusMeters={serverBaseRadiusMeters}
          onSave={(label, radiusMeters) => onConfirmPendingBase?.(label, radiusMeters)}
          onDiscard={() => onDiscardPendingBase?.()}
        />
      );
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
