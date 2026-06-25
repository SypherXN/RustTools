import { worldToGridLabel } from "@rusttools/shared";
import { MARKER_LABELS, MARKER_TYPE, parseMapMarkers, type ParsedMapMarker } from "./map-markers.js";

const EVENT_TYPE_ALIASES: Record<string, number> = {
  cargo: MARKER_TYPE.CARGO,
  chinook: MARKER_TYPE.CH47,
  ch47: MARKER_TYPE.CH47,
  heli: MARKER_TYPE.HELI,
  helicopter: MARKER_TYPE.HELI,
  patrol: MARKER_TYPE.HELI,
};

const DEFAULT_WORLD_EVENT_ENTITIES = ["cargo", "heli", "chinook", "vendor", "oil"];

const DEFAULT_EVENT_TYPES = [MARKER_TYPE.CARGO, MARKER_TYPE.CH47, MARKER_TYPE.HELI];

export function eventTeamChatEnabled(): boolean {
  return process.env.AUTOMATION_EVENT_TEAM_CHAT === "true";
}

/** Defaults to on when team chat alerts are on; set AUTOMATION_EVENT_DISCORD=false to disable. */
export function eventDiscordEnabled(): boolean {
  const explicit = process.env.AUTOMATION_EVENT_DISCORD?.trim().toLowerCase();
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return eventTeamChatEnabled();
}

export function mapEventAlertsEnabled(): boolean {
  return eventTeamChatEnabled() || eventDiscordEnabled();
}

export function configuredWorldEventEntities(): Set<string> {
  const raw =
    process.env.AUTOMATION_EVENT_TYPES?.trim() ||
    process.env.AUTOMATION_EVENT_TEAM_CHAT_TYPES?.trim();
  if (!raw) return new Set(DEFAULT_WORLD_EVENT_ENTITIES);
  const entities = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return entities.length > 0 ? new Set(entities) : new Set(DEFAULT_WORLD_EVENT_ENTITIES);
}

export function worldEventAnnouncementEnabled(
  announcement: { kind: string; entity?: string; oilRig?: string },
  enabled: Set<string>,
): boolean {
  if (announcement.kind.startsWith("oil")) {
    return enabled.has("oil") || enabled.has("large") || enabled.has("small") || enabled.has("chinook");
  }
  if (announcement.entity) return enabled.has(announcement.entity);
  return true;
}

export function configuredMapEventTypes(): number[] {
  const raw =
    process.env.AUTOMATION_EVENT_TYPES?.trim() ||
    process.env.AUTOMATION_EVENT_TEAM_CHAT_TYPES?.trim();
  if (!raw) return DEFAULT_EVENT_TYPES;
  const types = raw
    .split(",")
    .map((part) => EVENT_TYPE_ALIASES[part.trim().toLowerCase()])
    .filter((value): value is number => value != null);
  return types.length > 0 ? types : DEFAULT_EVENT_TYPES;
}

export function formatEventTeamChatMessage(
  marker: Pick<ParsedMapMarker, "label" | "x" | "y">,
  worldSize: number,
): string {
  const grid = worldToGridLabel(marker.x, marker.y, worldSize);
  const prefix = process.env.AUTOMATION_EVENT_TEAM_CHAT_PREFIX?.trim() || "RustTools";
  const name = marker.label.trim() || "World event";
  return `[${prefix}] ${name} @ ${grid} (${Math.round(marker.x)}, ${Math.round(marker.y)})`;
}

export function eventDiscordDescription(
  marker: Pick<ParsedMapMarker, "label" | "x" | "y" | "name">,
  worldSize: number,
): string {
  const grid = worldToGridLabel(marker.x, marker.y, worldSize);
  const title = marker.name.trim() && marker.name !== marker.label ? marker.name : marker.label;
  return `${title} @ ${grid} (${Math.round(marker.x)}, ${Math.round(marker.y)})`;
}

/** Announces each map event marker once per spawn (re-announces after it despawns). */
export class MapEventAnnouncer {
  private announcedIds = new Set<string>();
  private activeIds = new Set<string>();

  processMarkers(
    raw: unknown,
    enabledTypes: number[],
    onNewEvent: (marker: ParsedMapMarker) => void,
  ): void {
    const parsed = parseMapMarkers(raw);
    const events = parsed.filter((marker) => enabledTypes.includes(marker.type));
    const currentIds = new Set(events.map((marker) => marker.id));

    for (const id of this.activeIds) {
      if (!currentIds.has(id)) {
        this.announcedIds.delete(id);
      }
    }
    this.activeIds = currentIds;

    for (const marker of events) {
      if (this.announcedIds.has(marker.id)) continue;
      this.announcedIds.add(marker.id);
      onNewEvent(marker);
    }
  }
}

export function eventTypeLabel(type: number): string {
  return MARKER_LABELS[type] ?? "Event";
}
