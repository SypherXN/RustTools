import type { Database } from "@rusttools/db";
import {
  buildOilRigSnapshot,
  buildTrackedEntitySnapshot,
  emptyWorldEventStats,
  findOilRigMonuments,
  formatWorldEventAnnouncement,
  DEFAULT_LEGACY_AUTOMATION_SETTINGS,
  isBradleyMarker,
  isConvoyMarker,
  isTravelingVendorMarker,
  MAP_MARKER_TYPE,
  markerEntityLabel,
  nearestOilRig,
  type EventTimerSettings,
  type MonumentInput,
  type OilRigKind,
  type TrailPoint,
  type WorldEventAnnouncement,
  type WorldEventEntity,
  type WorldEventStats,
  type WorldEventsStatus,
} from "@rusttools/shared";
import { parseMapMarkers, type ParsedMapMarker } from "./map-markers.js";
import { loadWorldEventStats, saveWorldEventStats } from "./world-event-store.js";

const MAX_TRAIL_POINTS = 80;
const TRAIL_MIN_DISTANCE = 20;
const TRAIL_MIN_INTERVAL_SEC = 25;

interface ActiveEntity {
  id: string;
  x: number;
  y: number;
  sinceSec: number;
  egressAtSec: number | null;
  egressAnnounced: boolean;
  trail: TrailPoint[];
}

interface OilRigRuntime {
  triggeredAt: number | null;
  lastTriggeredAt: number | null;
  remindersSent: Set<number>;
  unlockAnnounced: boolean;
}

interface ServerRuntime {
  cargo: ActiveEntity | null;
  heli: ActiveEntity | null;
  chinook: ActiveEntity | null;
  vendor: ActiveEntity | null;
  bradley: ActiveEntity | null;
  convoy: ActiveEntity | null;
  oil: Record<OilRigKind, OilRigRuntime>;
  stats: WorldEventStats;
  spawnAnnounced: Set<string>;
  loaded: boolean;
}

function emptyOilRigRuntime(lastTriggeredAt: number | null = null): OilRigRuntime {
  return {
    triggeredAt: null,
    lastTriggeredAt,
    remindersSent: new Set(),
    unlockAnnounced: false,
  };
}

function emptyRuntime(persisted?: {
  stats: WorldEventStats;
  oilSmallLastTriggeredAt: number | null;
  oilLargeLastTriggeredAt: number | null;
}): ServerRuntime {
  return {
    cargo: null,
    heli: null,
    chinook: null,
    vendor: null,
    bradley: null,
    convoy: null,
    oil: {
      small: emptyOilRigRuntime(persisted?.oilSmallLastTriggeredAt ?? null),
      large: emptyOilRigRuntime(persisted?.oilLargeLastTriggeredAt ?? null),
    },
    stats: persisted?.stats ?? emptyWorldEventStats(),
    spawnAnnounced: new Set(),
    loaded: Boolean(persisted),
  };
}

function appendTrail(entity: ActiveEntity, x: number, y: number, nowSec: number): void {
  const last = entity.trail.at(-1);
  if (last) {
    const dx = x - last.x;
    const dy = y - last.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < TRAIL_MIN_DISTANCE && nowSec - last.t < TRAIL_MIN_INTERVAL_SEC) return;
  }
  entity.trail.push({ x, y, t: nowSec });
  if (entity.trail.length > MAX_TRAIL_POINTS) {
    entity.trail.splice(0, entity.trail.length - MAX_TRAIL_POINTS);
  }
}

function upsertEntity(
  current: ActiveEntity | null,
  marker: ParsedMapMarker,
  nowSec: number,
  egressAtSec: number | null,
): ActiveEntity {
  if (!current || current.id !== marker.id) {
    return {
      id: marker.id,
      x: marker.x,
      y: marker.y,
      sinceSec: nowSec,
      egressAtSec,
      egressAnnounced: false,
      trail: [{ x: marker.x, y: marker.y, t: nowSec }],
    };
  }
  current.x = marker.x;
  current.y = marker.y;
  appendTrail(current, marker.x, marker.y, nowSec);
  return current;
}

function pickMarkers(
  markers: ParsedMapMarker[],
  type: number,
): ParsedMapMarker[] {
  return markers.filter((marker) => marker.type === type);
}

function pickVendorMarkers(markers: ParsedMapMarker[]): ParsedMapMarker[] {
  return markers.filter((marker) => isTravelingVendorMarker(marker));
}

function pickBradleyMarkers(markers: ParsedMapMarker[]): ParsedMapMarker[] {
  return markers.filter((marker) => isBradleyMarker(marker));
}

function pickConvoyMarkers(markers: ParsedMapMarker[]): ParsedMapMarker[] {
  return markers.filter((marker) => isConvoyMarker(marker));
}

export class WorldEventTracker {
  private readonly runtimes = new Map<string, ServerRuntime>();

  private getRuntime(serverId: string): ServerRuntime {
    const existing = this.runtimes.get(serverId);
    if (existing) return existing;
    const initial = emptyRuntime();
    this.runtimes.set(serverId, initial);
    return initial;
  }

  async ensureLoaded(db: Database, serverId: string): Promise<ServerRuntime> {
    const runtime = this.getRuntime(serverId);
    if (runtime.loaded) return runtime;
    const persisted = await loadWorldEventStats(db, serverId);
    const next = emptyRuntime(persisted);
    this.runtimes.set(serverId, next);
    return next;
  }

  getStatus(
    serverId: string,
    worldSize: number,
    timers: EventTimerSettings,
    nowSec = Math.floor(Date.now() / 1000),
  ): WorldEventsStatus {
    const runtime = this.getRuntime(serverId);
    const buildActive = (entity: ActiveEntity | null) =>
      buildTrackedEntitySnapshot(
        entity
          ? {
              x: entity.x,
              y: entity.y,
              sinceSec: entity.sinceSec,
              egressAtSec: entity.egressAtSec,
              trail: entity.trail,
            }
          : null,
        worldSize,
        nowSec,
      );

    const withLastSeen = (
      snapshot: ReturnType<typeof buildActive>,
      lastDespawn: number | null,
      lastSpawn: number | null,
    ) => {
      if (snapshot.active) return snapshot;
      const sinceSec = lastDespawn ?? lastSpawn;
      return sinceSec != null ? { ...snapshot, sinceSec } : snapshot;
    };

    return {
      updatedAt: nowSec,
      cargo: withLastSeen(
        buildActive(runtime.cargo),
        runtime.stats.cargoLastDespawnAt,
        runtime.stats.cargoLastSpawnAt,
      ),
      heli: withLastSeen(
        buildActive(runtime.heli),
        runtime.stats.heliLastDespawnAt,
        runtime.stats.heliLastSpawnAt,
      ),
      chinook: withLastSeen(
        buildActive(runtime.chinook),
        runtime.stats.chinookLastDespawnAt,
        runtime.stats.chinookLastSpawnAt,
      ),
      vendor: withLastSeen(
        buildActive(runtime.vendor),
        runtime.stats.vendorLastDespawnAt,
        runtime.stats.vendorLastSpawnAt,
      ),
      bradley: withLastSeen(
        buildActive(runtime.bradley),
        runtime.stats.bradleyLastDespawnAt,
        runtime.stats.bradleyLastSpawnAt,
      ),
      convoy: withLastSeen(
        buildActive(runtime.convoy),
        runtime.stats.convoyLastDespawnAt,
        runtime.stats.convoyLastSpawnAt,
      ),
      oilRigs: {
        small: buildOilRigSnapshot(runtime.oil.small, timers, nowSec),
        large: buildOilRigSnapshot(runtime.oil.large, timers, nowSec),
      },
      stats: { ...runtime.stats },
    };
  }

  async process(
    db: Database,
    serverId: string,
    input: {
      markersRaw: unknown;
      monuments: MonumentInput[];
      worldSize: number;
      timers: EventTimerSettings;
    },
    nowSec = Math.floor(Date.now() / 1000),
  ): Promise<{ status: WorldEventsStatus; announcements: WorldEventAnnouncement[] }> {
    const runtime = await this.ensureLoaded(db, serverId);
    const announcements: WorldEventAnnouncement[] = [];
    const markers = parseMapMarkers(input.markersRaw);
    const rigs = findOilRigMonuments(input.monuments);
    const proximity = input.timers.oilRigProximityUnits;

    const processMobile = (
      key: WorldEventEntity,
      type: number,
      current: ActiveEntity | null,
      found: ParsedMapMarker[],
      statSpawn: keyof WorldEventStats,
      statDespawn: keyof WorldEventStats,
    ): ActiveEntity | null => {
      const marker = found[0] ?? null;
      const spawnKey = `${key}:${marker?.id ?? "none"}`;

      if (marker) {
        const egressAtSec =
          key === "cargo" ? nowSec + input.timers.cargoEgressSeconds : null;
        const wasActive = current != null;
        const next = upsertEntity(current, marker, nowSec, egressAtSec);

        if (!wasActive || current?.id !== marker.id) {
          runtime.stats[statSpawn] = nowSec;
          if (!runtime.spawnAnnounced.has(spawnKey)) {
            runtime.spawnAnnounced.add(spawnKey);
            announcements.push({
              kind: "spawn",
              entity: key,
              label:
                key === "vendor"
                  ? "Traveling Vendor"
                  : key === "bradley"
                    ? "Bradley APC"
                    : key === "convoy"
                      ? "Convoy"
                      : markerEntityLabel(type),
              x: marker.x,
              y: marker.y,
            });
          }
        }

        if (key === "cargo" && next.egressAtSec != null && !next.egressAnnounced) {
          if (nowSec >= next.egressAtSec) {
            next.egressAnnounced = true;
            announcements.push({
              kind: "cargo_egress",
              entity: "cargo",
              x: next.x,
              y: next.y,
            });
          }
        }

        return next;
      }

      if (current) {
        runtime.stats[statDespawn] = nowSec;
        runtime.spawnAnnounced.delete(`${key}:${current.id}`);
        if (key === "heli") {
          runtime.stats.heliLastDownAt = nowSec;
          announcements.push({
            kind: "heli_down",
            entity: "heli",
            x: current.x,
            y: current.y,
          });
        } else if (key === "vendor") {
          announcements.push({ kind: "vendor_despawn", entity: "vendor" });
        } else {
          announcements.push({
            kind: "despawn",
            entity: key,
            label: markerEntityLabel(type),
          });
        }
      }
      return null;
    };

    runtime.cargo = processMobile(
      "cargo",
      MAP_MARKER_TYPE.CARGO,
      runtime.cargo,
      pickMarkers(markers, MAP_MARKER_TYPE.CARGO),
      "cargoLastSpawnAt",
      "cargoLastDespawnAt",
    );
    runtime.heli = processMobile(
      "heli",
      MAP_MARKER_TYPE.HELI,
      runtime.heli,
      pickMarkers(markers, MAP_MARKER_TYPE.HELI),
      "heliLastSpawnAt",
      "heliLastDespawnAt",
    );
    runtime.chinook = processMobile(
      "chinook",
      MAP_MARKER_TYPE.CH47,
      runtime.chinook,
      pickMarkers(markers, MAP_MARKER_TYPE.CH47),
      "chinookLastSpawnAt",
      "chinookLastDespawnAt",
    );
    runtime.vendor = processMobile(
      "vendor",
      MAP_MARKER_TYPE.GENERIC,
      runtime.vendor,
      pickVendorMarkers(markers),
      "vendorLastSpawnAt",
      "vendorLastDespawnAt",
    );
    runtime.bradley = processMobile(
      "bradley",
      MAP_MARKER_TYPE.GENERIC,
      runtime.bradley,
      pickBradleyMarkers(markers),
      "bradleyLastSpawnAt",
      "bradleyLastDespawnAt",
    );
    runtime.convoy = processMobile(
      "convoy",
      MAP_MARKER_TYPE.GENERIC,
      runtime.convoy,
      pickConvoyMarkers(markers),
      "convoyLastSpawnAt",
      "convoyLastDespawnAt",
    );

    for (const kind of ["small", "large"] as const) {
      const rigState = runtime.oil[kind];
      const rigMonument = rigs[kind];
      if (!rigMonument) continue;

      if (rigState.triggeredAt != null) {
        const unlockAt = rigState.triggeredAt + input.timers.oilCrateUnlockSeconds;
        for (const minutes of input.timers.oilCrateReminderMinutes) {
          const target = unlockAt - minutes * 60;
          if (
            !rigState.remindersSent.has(minutes) &&
            nowSec >= target - 30 &&
            nowSec <= target + 30
          ) {
            rigState.remindersSent.add(minutes);
            announcements.push({ kind: "oil_reminder", oilRig: kind, minutesLeft: minutes });
          }
        }

        if (!rigState.unlockAnnounced && nowSec >= unlockAt) {
          rigState.unlockAnnounced = true;
          announcements.push({ kind: "oil_crate_unlocked", oilRig: kind });
          rigState.triggeredAt = null;
          rigState.remindersSent.clear();
        }
      }

      if (rigState.triggeredAt != null) continue;

      const chinooks = pickMarkers(markers, MAP_MARKER_TYPE.CH47);
      const crates = pickMarkers(markers, MAP_MARKER_TYPE.CRATE);
      const triggers = [...chinooks, ...crates];
      for (const marker of triggers) {
        const near = nearestOilRig(marker.x, marker.y, rigs, proximity);
        if (near !== kind) continue;
        rigState.triggeredAt = nowSec;
        rigState.lastTriggeredAt = nowSec;
        rigState.unlockAnnounced = false;
        rigState.remindersSent.clear();
        runtime.stats[kind === "small" ? "oilSmallLastTriggeredAt" : "oilLargeLastTriggeredAt"] =
          nowSec;
        announcements.push({ kind: "oil_triggered", oilRig: kind, x: marker.x, y: marker.y });
        break;
      }
    }

    await saveWorldEventStats(db, serverId, {
      stats: runtime.stats,
      oilSmallLastTriggeredAt: runtime.oil.small.lastTriggeredAt,
      oilLargeLastTriggeredAt: runtime.oil.large.lastTriggeredAt,
    });

    return {
      status: this.getStatus(serverId, input.worldSize, input.timers, nowSec),
      announcements,
    };
  }

  reset(serverId: string): void {
    this.runtimes.delete(serverId);
  }
}

export const worldEventTracker = new WorldEventTracker();

export function formatAnnouncementsForChat(
  announcements: WorldEventAnnouncement[],
  worldSize: number,
  prefix?: string,
): string[] {
  const resolvedPrefix =
    prefix?.trim() || DEFAULT_LEGACY_AUTOMATION_SETTINGS.mapEvents.prefix;
  return announcements.map((announcement) =>
    formatWorldEventAnnouncement(announcement, worldSize, resolvedPrefix),
  );
}
