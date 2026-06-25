import type { WorldEventsStatus } from "@rusttools/shared";
import { formatDurationSince } from "@rusttools/shared";
import type { MapEventTypeKey } from "./MapOverlay";

export interface TrackableEvent {
  id: string;
  label: string;
  grid: string | null;
  x: number | null;
  y: number | null;
  active: boolean;
  detail: string;
}

function buildEvents(status: WorldEventsStatus, nowSec: number): TrackableEvent[] {
  const items: TrackableEvent[] = [];

  const push = (
    id: string,
    label: string,
    snap: { active: boolean; x: number | null; y: number | null; grid: string | null; sinceSec: number | null },
    activeDetail: string,
    idleDetail: string,
  ) => {
    items.push({
      id,
      label,
      grid: snap.grid,
      x: snap.x,
      y: snap.y,
      active: snap.active,
      detail: snap.active
        ? activeDetail
        : snap.sinceSec
          ? idleDetail.replace("{since}", formatDurationSince(snap.sinceSec, nowSec))
          : "Off map",
    });
  };

  push(
    "cargo",
    "Cargo Ship",
    status.cargo,
    `Active @ ${status.cargo.grid ?? "?"}`,
    "Last seen {since} ago",
  );
  push(
    "heli",
    "Patrol Heli",
    status.heli,
    `Active @ ${status.heli.grid ?? "?"}`,
    status.stats.heliLastDownAt
      ? `Down ${formatDurationSince(status.stats.heliLastDownAt, nowSec)}`
      : "Last seen {since} ago",
  );
  push(
    "chinook",
    "Chinook",
    status.chinook,
    `Active @ ${status.chinook.grid ?? "?"}`,
    "Last seen {since} ago",
  );
  push(
    "vendor",
    "Traveling Vendor",
    status.vendor,
    `Active @ ${status.vendor.grid ?? "?"}`,
    "Last seen {since} ago",
  );
  push(
    "bradley",
    "Bradley APC",
    status.bradley,
    `Active @ ${status.bradley.grid ?? "?"}`,
    "Last seen {since} ago",
  );
  push(
    "convoy",
    "Convoy",
    status.convoy,
    `Active @ ${status.convoy.grid ?? "?"}`,
    "Last seen {since} ago",
  );

  return items;
}

/** World events that can be tracked on the map (matches layer event type keys). */
export function buildTrackableEvents(
  status: WorldEventsStatus,
  nowSec = Math.floor(Date.now() / 1000),
): TrackableEvent[] {
  return buildEvents(status, nowSec);
}

const TRACKABLE_LAYER_KEYS = new Set([
  "cargo",
  "heli",
  "chinook",
  "vendor",
  "bradley",
  "convoy",
]);

export function isTrackableLayerKey(key: string): key is MapEventTypeKey {
  return TRACKABLE_LAYER_KEYS.has(key);
}

interface MapEventDockProps {
  worldEvents: WorldEventsStatus | null;
  onTrack: (event: TrackableEvent) => void;
  trackingId: string | null;
}

export function MapEventDock({ worldEvents, onTrack, trackingId }: MapEventDockProps) {
  if (!worldEvents) {
    return (
      <section className="card map-event-dock">
        <h2>Events</h2>
        <p className="muted">World event tracking unavailable.</p>
      </section>
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const events = buildEvents(worldEvents, nowSec);

  return (
    <section className="card map-event-dock">
      <h2>Event Dock</h2>
      <p className="muted map-event-dock-hint">Click Track to lock the map on an active event.</p>
      <ul className="map-event-dock-list">
        {events.map((ev) => (
          <li key={ev.id} className={trackingId === ev.id ? "active" : undefined}>
            <div className="map-event-dock-meta">
              <strong>{ev.label}</strong>
              <span className="muted">{ev.detail}</span>
            </div>
            <button
              type="button"
              className="btn-secondary"
              disabled={ev.x == null || ev.y == null}
              onClick={() => onTrack(ev)}
            >
              {trackingId === ev.id ? "Tracking" : "Track"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export type { TrackableEvent as MapTrackableEvent };