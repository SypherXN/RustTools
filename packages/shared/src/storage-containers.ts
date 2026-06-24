import catalog from "./data/storage-container-icons.json" with { type: "json" };
import { rustItemIconUrl } from "./item-icons.js";
import type { ParsedStorage } from "./storage.js";

export type StorageContainerKind =
  | "tool_cupboard"
  | "large_box"
  | "small_box"
  | "barrel"
  | "vending"
  | "unknown";

export interface StorageContainerIconOption {
  shortname: string;
  name: string;
  iconUrl: string;
}

export interface StorageContainerIconCatalog {
  tool_cupboard: StorageContainerIconOption[];
  large_box: StorageContainerIconOption[];
  small_box: StorageContainerIconOption[];
  barrel: StorageContainerIconOption[];
  vending: StorageContainerIconOption[];
}

export interface ResolvedStorageMonitorIcon {
  shortname: string;
  name: string;
  iconUrl: string;
  kind: StorageContainerKind;
  autoDetected: boolean;
}

/** Rust+ capacity hints (community conventions, not official API). */
export const STORAGE_MONITOR_TC_CAPACITY = 29;
export const STORAGE_MONITOR_VENDING_CAPACITY = 30;
export const STORAGE_MONITOR_LARGE_BOX_CAPACITY = 48;
export const STORAGE_MONITOR_SMALL_BOX_CAPACITY = 12;

const DEFAULT_SHORTNAME: Record<StorageContainerKind, string> = {
  tool_cupboard: "cupboard.tool",
  large_box: "box.wooden.large",
  small_box: "box.wooden",
  barrel: "storage_barrel_b",
  vending: "vending.machine",
  unknown: "box.wooden.large",
};

function withIconUrl(
  entry: { shortname: string; name: string },
): StorageContainerIconOption {
  return { ...entry, iconUrl: rustItemIconUrl(entry.shortname) };
}

const rawCatalog = catalog as Record<string, Array<{ shortname: string; name: string }>>;

export const STORAGE_CONTAINER_ICON_CATALOG: StorageContainerIconCatalog = {
  tool_cupboard: rawCatalog.tool_cupboard.map(withIconUrl),
  large_box: rawCatalog.large_box.map(withIconUrl),
  small_box: rawCatalog.small_box.map(withIconUrl),
  barrel: rawCatalog.barrel.map(withIconUrl),
  vending: rawCatalog.vending.map(withIconUrl),
};

export function detectStorageContainerKind(
  parsed: Pick<ParsedStorage, "isToolCupboard" | "capacity"> | null,
): StorageContainerKind {
  if (!parsed) return "unknown";
  if (parsed.isToolCupboard || parsed.capacity === STORAGE_MONITOR_TC_CAPACITY) {
    return "tool_cupboard";
  }
  if (parsed.capacity === STORAGE_MONITOR_VENDING_CAPACITY) return "vending";
  if (parsed.capacity === STORAGE_MONITOR_SMALL_BOX_CAPACITY) return "small_box";
  if (parsed.capacity === STORAGE_MONITOR_LARGE_BOX_CAPACITY) return "large_box";
  return "unknown";
}

function lookupIconName(shortname: string): string {
  for (const key of Object.keys(STORAGE_CONTAINER_ICON_CATALOG) as Array<
    keyof StorageContainerIconCatalog
  >) {
    const hit = STORAGE_CONTAINER_ICON_CATALOG[key].find(
      (opt: StorageContainerIconOption) => opt.shortname === shortname,
    );
    if (hit) return hit.name;
  }
  return shortname;
}

export function iconOptionsForKind(kind: StorageContainerKind): StorageContainerIconOption[] {
  if (kind === "unknown") {
    return [
      ...STORAGE_CONTAINER_ICON_CATALOG.large_box,
      ...STORAGE_CONTAINER_ICON_CATALOG.barrel,
      ...STORAGE_CONTAINER_ICON_CATALOG.small_box,
    ];
  }
  if (kind === "large_box") {
    return [...STORAGE_CONTAINER_ICON_CATALOG.large_box, ...STORAGE_CONTAINER_ICON_CATALOG.barrel];
  }
  return STORAGE_CONTAINER_ICON_CATALOG[kind] ?? STORAGE_CONTAINER_ICON_CATALOG.large_box;
}

export function resolveStorageMonitorIcon(opts: {
  savedIcon: string | null | undefined;
  parsed: ParsedStorage | null;
}): ResolvedStorageMonitorIcon {
  const kind = detectStorageContainerKind(opts.parsed);

  if (opts.savedIcon) {
    return {
      shortname: opts.savedIcon,
      name: lookupIconName(opts.savedIcon),
      iconUrl: rustItemIconUrl(opts.savedIcon),
      kind,
      autoDetected: false,
    };
  }

  const shortname = DEFAULT_SHORTNAME[kind];
  return {
    shortname,
    name: lookupIconName(shortname),
    iconUrl: rustItemIconUrl(shortname),
    kind,
    autoDetected: true,
  };
}
