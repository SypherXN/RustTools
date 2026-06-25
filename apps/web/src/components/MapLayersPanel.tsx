import type { MapDrawingStroke, MapPin, WorldEventsStatus } from "@rusttools/shared";
import type { MapEventTypeKey, MapLayers } from "./MapOverlay";
import { buildTrackableEvents, isTrackableLayerKey, type TrackableEvent } from "./MapEventDock";

const EVENT_TYPE_LABELS: Record<MapEventTypeKey, string> = {
  cargo: "Cargo ship",
  heli: "Patrol heli",
  chinook: "Chinook",
  vendor: "Traveling vendor",
  bradley: "Bradley",
  convoy: "Convoy",
  crate: "Crates",
  other: "Other events",
};

interface MapLayersPanelProps {
  layers: MapLayers;
  onlineCount: number;
  teamOnMapCount: number;
  vendingCount: number;
  monumentCount: number;
  eventCount: number;
  eventTypeCounts: Record<MapEventTypeKey, number>;
  showTeamOverlays: boolean;
  drawings: MapDrawingStroke[];
  pins: MapPin[];
  canSwitch: boolean;
  onToggleLayer: (key: keyof Omit<MapLayers, "eventTypes">) => void;
  onToggleEventType: (key: MapEventTypeKey) => void;
  onToggleAllEventTypes: (enabled: boolean) => void;
  onShowTeamOverlaysChange: (value: boolean) => void;
  onRefresh: () => void;
  onDeletePin: (id: string) => void;
  onDeleteDrawing: (id: string) => void;
  onSelectPin: (pinId: string) => void;
  onSelectDrawing: (drawingId: string) => void;
  worldEvents: WorldEventsStatus | null;
  trackingId: string | null;
  onTrackEvent: (event: TrackableEvent) => void;
}

function LayerCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="map-layer-row">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

export function MapLayersPanel({
  layers,
  onlineCount,
  teamOnMapCount,
  vendingCount,
  monumentCount,
  eventCount,
  eventTypeCounts,
  showTeamOverlays,
  drawings,
  pins,
  canSwitch,
  onToggleLayer,
  onToggleEventType,
  onToggleAllEventTypes,
  onShowTeamOverlaysChange,
  onRefresh,
  onDeletePin,
  onDeleteDrawing,
  onSelectPin,
  onSelectDrawing,
  worldEvents,
  trackingId,
  onTrackEvent,
}: MapLayersPanelProps) {
  const allEventTypesOn = (Object.keys(layers.eventTypes) as MapEventTypeKey[]).every(
    (key) => layers.eventTypes[key],
  );
  const someEventTypesOn = (Object.keys(layers.eventTypes) as MapEventTypeKey[]).some(
    (key) => layers.eventTypes[key],
  );
  const trackableEvents = worldEvents ? buildTrackableEvents(worldEvents) : [];
  const trackableByKey = new Map(trackableEvents.map((ev) => [ev.id as MapEventTypeKey, ev]));

  return (
    <aside className="map-layers-panel card">
      <h2>Layers</h2>

      <details className="map-layer-group">
        <summary>World</summary>
        <div className="map-layer-group-body">
          <LayerCheckbox
            checked={layers.team}
            onChange={() => onToggleLayer("team")}
            label={`Team (${onlineCount} online / ${teamOnMapCount})`}
          />
          <LayerCheckbox
            checked={layers.vending}
            onChange={() => onToggleLayer("vending")}
            label={`Vending (${vendingCount})`}
          />
          <LayerCheckbox
            checked={layers.monuments}
            onChange={() => onToggleLayer("monuments")}
            label={`Monuments (${monumentCount})`}
          />
        </div>
      </details>

      <details className="map-layer-group">
        <summary>
          <label className="map-layer-summary-row" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={layers.events}
              ref={(el) => {
                if (el) el.indeterminate = layers.events && !allEventTypesOn && someEventTypesOn;
              }}
              onChange={() => {
                if (layers.events && allEventTypesOn) {
                  onToggleLayer("events");
                } else if (!layers.events) {
                  onToggleLayer("events");
                  onToggleAllEventTypes(true);
                } else {
                  onToggleAllEventTypes(true);
                }
              }}
            />
            <span>Events ({eventCount})</span>
          </label>
        </summary>
        <div className="map-layer-group-body map-layer-group-nested">
          {(Object.keys(EVENT_TYPE_LABELS) as MapEventTypeKey[]).map((key) => {
            const trackable = isTrackableLayerKey(key) ? trackableByKey.get(key) : undefined;
            return (
              <div
                key={key}
                className={`map-layer-event-row${trackingId === key ? " tracking" : ""}`}
              >
                <LayerCheckbox
                  checked={layers.events && layers.eventTypes[key]}
                  onChange={() => onToggleEventType(key)}
                  label={`${EVENT_TYPE_LABELS[key]} (${eventTypeCounts[key]})`}
                />
                {trackable && (
                  <div className="map-layer-event-track">
                    <span className="muted map-layer-event-status">{trackable.detail}</span>
                    <button
                      type="button"
                      className={`btn-secondary map-layer-track-btn${trackingId === key ? " active" : ""}`}
                      disabled={trackable.x == null || trackable.y == null}
                      onClick={() => onTrackEvent(trackable)}
                    >
                      {trackingId === key ? "Tracking" : "Track"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </details>

      <details className="map-layer-group">
        <summary>Overlays</summary>
        <div className="map-layer-group-body">
          <LayerCheckbox
            checked={layers.grid}
            onChange={() => onToggleLayer("grid")}
            label="Grid"
          />
          <LayerCheckbox
            checked={showTeamOverlays}
            onChange={() => onShowTeamOverlaysChange(!showTeamOverlays)}
            label={`Team annotations (${drawings.length} drawings, ${pins.length} pins)`}
          />
          {showTeamOverlays && (drawings.length > 0 || pins.length > 0) && (
            <div className="map-overlay-list">
              <h3>Team annotations</h3>
              {pins.length > 0 && (
                <ul>
                  {pins.map((pin) => (
                    <li key={pin.id}>
                      <button
                        type="button"
                        className="map-overlay-list-item"
                        onClick={() => onSelectPin(pin.id)}
                      >
                        <strong>{pin.label}</strong>
                        <span className="muted">pin</span>
                      </button>
                      {canSwitch && (
                        <button
                          type="button"
                          className="btn-secondary map-overlay-delete"
                          onClick={() => void onDeletePin(pin.id)}
                        >
                          Delete
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {drawings.length > 0 && (
                <ul>
                  {drawings.map((stroke) => (
                    <li key={stroke.id}>
                      <button
                        type="button"
                        className="map-overlay-list-item"
                        onClick={() => onSelectDrawing(stroke.id)}
                      >
                        <span className="map-drawing-color-preview" style={{ background: stroke.color }} />
                        <strong>{stroke.label || "Drawing"}</strong>
                        <span className="muted">by {stroke.createdBy}</span>
                      </button>
                      {canSwitch && (
                        <button
                          type="button"
                          className="btn-secondary map-overlay-delete"
                          onClick={() => void onDeleteDrawing(stroke.id)}
                        >
                          Delete
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </details>

      <button type="button" className="btn-secondary map-layers-refresh" onClick={onRefresh}>
        Refresh now
      </button>

      <ul className="map-legend">
        <li><span className="legend-swatch team-online" /> Team (online)</li>
        <li><span className="legend-swatch team-offline" /> Team (offline)</li>
        <li><span className="legend-swatch vending" /> Vending (in stock)</li>
        <li><span className="legend-swatch vending-out" /> Vending (empty)</li>
        <li><span className="legend-swatch monument" /> Monument</li>
        <li><span className="legend-swatch events" /> Events</li>
        <li><span className="legend-swatch grid" /> Grid (150m cells)</li>
        <li><span className="legend-swatch monument" style={{ background: "#eab308" }} /> Team pin</li>
      </ul>

      {canSwitch && (
        <p className="muted map-layers-hint">
          Click <strong>Annotate</strong> on the map toolbar, choose <strong>Draw</strong> or{" "}
          <strong>Pin</strong>, then click or drag on the map.
        </p>
      )}
    </aside>
  );
}
