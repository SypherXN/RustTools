import { worldToGridLabel } from "./map-grid.js";
import { MAP_MARKER_TYPE } from "./map-marker-types.js";

export type OilRigKind = "small" | "large";

export interface EventTimerSettings {
  /** Seconds after cargo spawn before egress notification (default 45 min). */
  cargoEgressSeconds: number;
  /** Seconds from oil rig trigger until locked crate unlocks (default 15 min). */
  oilCrateUnlockSeconds: number;
  /** Team chat reminders this many minutes before crate unlock (e.g. 10, 5, 1). */
  oilCrateReminderMinutes: number[];
  /** World units — chinook/crate within this distance of rig counts as triggered. */
  oilRigProximityUnits: number;
}

export const DEFAULT_EVENT_TIMER_SETTINGS: EventTimerSettings = {
  cargoEgressSeconds: 2700,
  oilCrateUnlockSeconds: 900,
  oilCrateReminderMinutes: [10, 5, 1],
  oilRigProximityUnits: 250,
};

export interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

export interface TrackedEntitySnapshot {
  active: boolean;
  x: number | null;
  y: number | null;
  grid: string | null;
  sinceSec: number | null;
  egressInSec: number | null;
  trail: TrailPoint[];
}

export interface OilRigSnapshot {
  triggered: boolean;
  triggeredAt: number | null;
  crateUnlockAt: number | null;
  crateUnlockInSec: number | null;
  crateUnlockLabel: string | null;
  lastTriggeredAt: number | null;
}

export interface WorldEventStats {
  cargoLastSpawnAt: number | null;
  cargoLastDespawnAt: number | null;
  heliLastSpawnAt: number | null;
  heliLastDespawnAt: number | null;
  heliLastDownAt: number | null;
  chinookLastSpawnAt: number | null;
  chinookLastDespawnAt: number | null;
  vendorLastSpawnAt: number | null;
  vendorLastDespawnAt: number | null;
  bradleyLastSpawnAt: number | null;
  bradleyLastDespawnAt: number | null;
  convoyLastSpawnAt: number | null;
  convoyLastDespawnAt: number | null;
  oilSmallLastTriggeredAt: number | null;
  oilLargeLastTriggeredAt: number | null;
}

export interface WorldEventsStatus {
  updatedAt: number;
  cargo: TrackedEntitySnapshot;
  heli: TrackedEntitySnapshot;
  chinook: TrackedEntitySnapshot;
  vendor: TrackedEntitySnapshot;
  bradley: TrackedEntitySnapshot;
  convoy: TrackedEntitySnapshot;
  oilRigs: Record<OilRigKind, OilRigSnapshot>;
  stats: WorldEventStats;
}

export interface MapMarkerInput {
  id: string;
  type: number;
  name: string;
  x: number;
  y: number;
  radius?: number;
}

export interface MonumentInput {
  token: string;
  x: number;
  y: number;
}

export function classifyOilRigMonument(token: string): OilRigKind | null {
  const t = token.toLowerCase();
  if (/small.*oil|oil.*small/.test(t)) return "small";
  if (/large.*oil|oil.*large|oil_rig/.test(t)) return "large";
  return null;
}

export function findOilRigMonuments(monuments: MonumentInput[]): Record<OilRigKind, MonumentInput | null> {
  const rigs: Record<OilRigKind, MonumentInput | null> = { small: null, large: null };
  for (const monument of monuments) {
    const kind = classifyOilRigMonument(monument.token);
    if (kind && !rigs[kind]) rigs[kind] = monument;
  }
  return rigs;
}

export function distance2d(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

export function nearestOilRig(
  x: number,
  y: number,
  rigs: Record<OilRigKind, MonumentInput | null>,
  maxDistance: number,
): OilRigKind | null {
  let best: { kind: OilRigKind; dist: number } | null = null;
  for (const kind of ["small", "large"] as const) {
    const rig = rigs[kind];
    if (!rig) continue;
    const dist = distance2d(x, y, rig.x, rig.y);
    if (dist <= maxDistance && (!best || dist < best.dist)) {
      best = { kind, dist };
    }
  }
  return best?.kind ?? null;
}

export function formatDurationSince(seconds: number | null, nowSec: number): string {
  if (seconds == null) return "never";
  const elapsed = Math.max(0, nowSec - seconds);
  if (elapsed < 60) return `${elapsed}s ago`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
  if (elapsed < 86_400) {
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
  }
  const d = Math.floor(elapsed / 86_400);
  const h = Math.floor((elapsed % 86_400) / 3600);
  return h > 0 ? `${d}d ${h}h ago` : `${d}d ago`;
}

export function formatCountdown(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    return min > 0 ? `${h}h ${min}m` : `${h}h`;
  }
  if (m > 0) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  return `${s}s`;
}

export function emptyTrackedEntity(): TrackedEntitySnapshot {
  return {
    active: false,
    x: null,
    y: null,
    grid: null,
    sinceSec: null,
    egressInSec: null,
    trail: [],
  };
}

export function emptyOilRigSnapshot(): OilRigSnapshot {
  return {
    triggered: false,
    triggeredAt: null,
    crateUnlockAt: null,
    crateUnlockInSec: null,
    crateUnlockLabel: null,
    lastTriggeredAt: null,
  };
}

export function emptyWorldEventStats(): WorldEventStats {
  return {
    cargoLastSpawnAt: null,
    cargoLastDespawnAt: null,
    heliLastSpawnAt: null,
    heliLastDespawnAt: null,
    heliLastDownAt: null,
    chinookLastSpawnAt: null,
    chinookLastDespawnAt: null,
    vendorLastSpawnAt: null,
    vendorLastDespawnAt: null,
    bradleyLastSpawnAt: null,
    bradleyLastDespawnAt: null,
    convoyLastSpawnAt: null,
    convoyLastDespawnAt: null,
    oilSmallLastTriggeredAt: null,
    oilLargeLastTriggeredAt: null,
  };
}

export function buildOilRigSnapshot(
  state: {
    triggeredAt: number | null;
    lastTriggeredAt: number | null;
  },
  timers: EventTimerSettings,
  nowSec: number,
): OilRigSnapshot {
  const triggered = state.triggeredAt != null;
  const crateUnlockAt = triggered
    ? state.triggeredAt! + timers.oilCrateUnlockSeconds
    : null;
  const crateUnlockInSec = crateUnlockAt != null ? Math.max(0, crateUnlockAt - nowSec) : null;
  return {
    triggered,
    triggeredAt: state.triggeredAt,
    crateUnlockAt,
    crateUnlockInSec,
    crateUnlockLabel: formatCountdown(crateUnlockInSec),
    lastTriggeredAt: state.lastTriggeredAt,
  };
}

export function buildTrackedEntitySnapshot(
  active: {
    x: number;
    y: number;
    sinceSec: number;
    egressAtSec: number | null;
    trail: TrailPoint[];
  } | null,
  worldSize: number,
  nowSec: number,
): TrackedEntitySnapshot {
  if (!active) return emptyTrackedEntity();
  return {
    active: true,
    x: active.x,
    y: active.y,
    grid: worldToGridLabel(active.x, active.y, worldSize),
    sinceSec: active.sinceSec,
    egressInSec:
      active.egressAtSec != null ? Math.max(0, active.egressAtSec - nowSec) : null,
    trail: active.trail,
  };
}

export type WorldEventEntity = "cargo" | "heli" | "chinook" | "vendor" | "bradley" | "convoy";

export type WorldEventAnnouncementKind =
  | "spawn"
  | "despawn"
  | "heli_down"
  | "cargo_egress"
  | "oil_triggered"
  | "oil_crate_unlocked"
  | "oil_reminder"
  | "vendor_despawn";

export interface WorldEventAnnouncement {
  kind: WorldEventAnnouncementKind;
  entity?: WorldEventEntity;
  oilRig?: OilRigKind;
  x?: number;
  y?: number;
  label?: string;
  minutesLeft?: number;
}

export function formatWorldEventAnnouncement(
  announcement: WorldEventAnnouncement,
  worldSize: number,
  prefix = "RustTools",
): string {
  const grid =
    announcement.x != null && announcement.y != null
      ? worldToGridLabel(announcement.x, announcement.y, worldSize)
      : null;
  const at = grid ? ` @ ${grid}` : "";

  switch (announcement.kind) {
    case "spawn":
      return `[${prefix}] ${announcement.label ?? announcement.entity} spawned${at}`;
    case "despawn":
      return `[${prefix}] ${announcement.label ?? announcement.entity} left the map`;
    case "heli_down":
      return `[${prefix}] Patrol heli downed${at}`;
    case "cargo_egress":
      return `[${prefix}] Cargo ship entering egress${at}`;
    case "oil_triggered":
      return `[${prefix}] ${announcement.oilRig === "large" ? "Large" : "Small"} Oil Rig triggered — Heavy Scientists`;
    case "oil_crate_unlocked":
      return `[${prefix}] ${announcement.oilRig === "large" ? "Large" : "Small"} Oil Rig locked crate unlocked`;
    case "oil_reminder":
      return `[${prefix}] ${announcement.oilRig === "large" ? "Large" : "Small"} Oil Rig crate unlocks in ${announcement.minutesLeft}m`;
    case "vendor_despawn":
      return `[${prefix}] Traveling Vendor left the map`;
    default:
      return `[${prefix}] World event update`;
  }
}

export const TRACKED_MARKER_TYPES = {
  cargo: MAP_MARKER_TYPE.CARGO,
  heli: MAP_MARKER_TYPE.HELI,
  chinook: MAP_MARKER_TYPE.CH47,
} as const;

export function markerEntityLabel(type: number): string {
  if (type === MAP_MARKER_TYPE.CARGO) return "Cargo Ship";
  if (type === MAP_MARKER_TYPE.HELI) return "Patrol Heli";
  if (type === MAP_MARKER_TYPE.CH47) return "Chinook";
  return "Event";
}
