import type { MapEventAutomationSettings } from "@rusttools/shared";
import {
  legacyAutomationsFromEnv,
  mapEventDiscordEnabled,
  mapEventTeamChatEnabled,
  resolveMapEventAutomationSettings,
} from "@rusttools/shared";
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

export function resolveMapEventSettings(
  stored?: Partial<MapEventAutomationSettings> | null,
): MapEventAutomationSettings {
  return resolveMapEventAutomationSettings(stored ?? legacyAutomationsFromEnv().mapEvents);
}

export function eventTeamChatEnabled(settings?: MapEventAutomationSettings): boolean {
  return mapEventTeamChatEnabled(resolveMapEventSettings(settings));
}

export function eventDiscordEnabled(settings?: MapEventAutomationSettings): boolean {
  return mapEventDiscordEnabled(resolveMapEventSettings(settings));
}

export function configuredWorldEventEntities(
  settings?: MapEventAutomationSettings,
): Set<string> {
  const resolved = resolveMapEventSettings(settings);
  return new Set(resolved.types.map((t) => t.toLowerCase()));
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

export function configuredMapEventTypes(settings?: MapEventAutomationSettings): number[] {
  const resolved = resolveMapEventSettings(settings);
  const types = resolved.types
    .map((part) => EVENT_TYPE_ALIASES[part.trim().toLowerCase()])
    .filter((value): value is number => value != null);
  return types.length > 0 ? types : [MARKER_TYPE.CARGO, MARKER_TYPE.CH47, MARKER_TYPE.HELI];
}

export function formatEventTeamChatMessage(
  marker: Pick<ParsedMapMarker, "label" | "x" | "y">,
  worldSize: number,
  prefix?: string,
): string {
  const grid = worldToGridLabel(marker.x, marker.y, worldSize);
  const resolvedPrefix = prefix?.trim() || legacyAutomationsFromEnv().mapEvents.prefix;
  const name = marker.label.trim() || "World event";
  return `[${resolvedPrefix}] ${name} @ ${grid} (${Math.round(marker.x)}, ${Math.round(marker.y)})`;
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
