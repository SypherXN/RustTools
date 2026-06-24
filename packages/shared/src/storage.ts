import { rustItemIconUrl } from "./item-icons.js";
import type { ContainerItem } from "./recycle.js";
import { resolveRustItem } from "./rust-items.js";

export type UpkeepLevel = "ok" | "warning" | "critical";

export interface StorageItemView {
  itemId: number;
  shortname: string;
  name: string;
  quantity: number;
  iconUrl: string;
  isBlueprint: boolean;
}

export interface StorageUpkeep {
  secondsRemaining: number;
  expiresAt: number | null;
  label: string;
  level: UpkeepLevel;
}

export interface ParsedStorage {
  items: StorageItemView[];
  capacity: number | null;
  isToolCupboard: boolean;
  upkeep: StorageUpkeep | null;
  /** Present when `isToolCupboard` — 4 upkeep slots + 5 other slots. */
  tcStorage?: TcSplitStorage;
}

/** Rust TC upkeep resource item IDs (vanilla only). */
export const UPKEEP_MATERIAL_IDS = new Set([
  -151838493, // wood
  -2099697608, // stones
  69511070, // metal.fragments
  317398316, // metal.refined
]);

const UPKEEP_MATERIAL_SHORTNAMES = new Set([
  "wood",
  "stones",
  "metal.fragments",
  "metal.refined",
]);

/** Fixed upkeep slot order as shown in-game (wood → stone → frags → HQM). */
export const UPKEEP_SLOT_ORDER = [
  { id: -151838493, shortname: "wood" },
  { id: -2099697608, shortname: "stones" },
  { id: 69511070, shortname: "metal.fragments" },
  { id: 317398316, shortname: "metal.refined" },
] as const;

export const TC_OTHER_SLOT_COUNT = 5;

export interface TcSplitStorage {
  upkeepSlots: Array<StorageItemView | null>;
  otherSlots: Array<StorageItemView | null>;
}

export function isUpkeepMaterial(item: Pick<StorageItemView, "itemId" | "shortname">): boolean {
  if (UPKEEP_MATERIAL_IDS.has(item.itemId)) return true;
  const sn = item.shortname.trim().toLowerCase();
  return UPKEEP_MATERIAL_SHORTNAMES.has(sn);
}

export function upkeepSlotIndex(item: Pick<StorageItemView, "itemId" | "shortname">): number {
  const sn = item.shortname.trim().toLowerCase();
  return UPKEEP_SLOT_ORDER.findIndex(
    (slot) => slot.id === item.itemId || slot.shortname === sn,
  );
}

function mergeStorageItems(
  existing: StorageItemView | null,
  item: StorageItemView,
): StorageItemView {
  if (!existing) return item;
  return { ...existing, quantity: existing.quantity + item.quantity };
}

const MAX_UPKEEP_SECONDS = 86400 * 365 * 2;

/** Read seconds until upkeep protection ends (Rust+ payload shapes). */
export function readUpkeepSeconds(
  payload: Record<string, unknown>,
  nowSec = Math.floor(Date.now() / 1000),
): number {
  const directFields = [
    "upkeepSeconds",
    "UpkeepSeconds",
    "protectionSeconds",
    "ProtectionSeconds",
    "secondsRemaining",
    "SecondsRemaining",
  ];
  for (const field of directFields) {
    const value = Number(payload[field] ?? 0);
    if (value > 0 && value <= MAX_UPKEEP_SECONDS) return Math.floor(value);
  }

  const expiry = Number(payload.protectionExpiry ?? payload.ProtectionExpiry ?? 0);
  if (expiry > nowSec) return Math.floor(expiry - nowSec);
  // Some servers send seconds remaining in protectionExpiry instead of a unix timestamp.
  if (expiry > 0 && expiry <= MAX_UPKEEP_SECONDS) return Math.floor(expiry);

  return 0;
}

export function splitToolCupboardStorage(items: StorageItemView[]): TcSplitStorage {
  const upkeepSlots: Array<StorageItemView | null> = UPKEEP_SLOT_ORDER.map(() => null);
  const others: StorageItemView[] = [];

  for (const item of items) {
    const slotIdx = upkeepSlotIndex(item);
    if (slotIdx >= 0) {
      upkeepSlots[slotIdx] = mergeStorageItems(upkeepSlots[slotIdx], item);
    } else {
      others.push(item);
    }
  }

  const otherSlots = Array.from({ length: TC_OTHER_SLOT_COUNT }, (_, index) => {
    return others[index] ?? null;
  });

  return { upkeepSlots, otherSlots };
}

function unwrapPayload(info: unknown): Record<string, unknown> {
  const root = info as Record<string, unknown>;
  return (root.payload ?? root) as Record<string, unknown>;
}

function readBool(value: unknown): boolean {
  return value === true || value === 1 || value === "true";
}

export function extractContainerItems(info: unknown): ContainerItem[] {
  const payload = unwrapPayload(info);
  const raw = payload.items as Array<Record<string, unknown>> | undefined;
  if (!raw?.length) return [];

  return raw.map((it) => {
    const itemId = Number(it.itemId ?? it.ItemId ?? it.id ?? 0);
    const shortname = String(
      it.shortName ?? it.shortname ?? it.ShortName ?? it.name ?? "",
    ).trim();
    const quantity = Number(it.quantity ?? it.Quantity ?? it.amount ?? it.Amount ?? 0);
    const itemIsBlueprint = readBool(it.itemIsBlueprint ?? it.ItemIsBlueprint);
    return { itemId, shortname: shortname || undefined, quantity, itemIsBlueprint };
  });
}

export function formatUpkeepRemaining(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function upkeepLevel(seconds: number): UpkeepLevel {
  if (seconds < 3600) return "critical";
  if (seconds < 86_400) return "warning";
  return "ok";
}

export function parseStorageEntityInfo(
  info: unknown,
  nowSec = Math.floor(Date.now() / 1000),
): ParsedStorage {
  const payload = unwrapPayload(info);
  const rawItems = extractContainerItems(info);

  const hasProtection = readBool(
    payload.hasProtection ?? payload.HasProtection ?? payload.isBuildingPrivilege,
  );
  const capacityRaw = payload.capacity ?? payload.Capacity;
  const capacity = capacityRaw != null ? Number(capacityRaw) : null;

  const items: StorageItemView[] = rawItems
    .filter((item) => (item.quantity ?? 0) > 0)
    .map((item) => {
      const resolved = resolveRustItem(item.itemId ?? 0);
      const shortname =
        item.shortname && item.shortname !== String(item.itemId)
          ? item.shortname
          : resolved.shortname;
      return {
        itemId: Number(item.itemId ?? resolved.id),
        shortname,
        name: resolved.name,
        quantity: item.quantity ?? 1,
        iconUrl: rustItemIconUrl(shortname),
        isBlueprint: item.itemIsBlueprint ?? false,
      };
    });

  let upkeep: StorageUpkeep | null = null;
  if (hasProtection) {
    const secondsRemaining = readUpkeepSeconds(payload, nowSec);
    if (secondsRemaining > 0) {
      upkeep = {
        secondsRemaining,
        expiresAt: nowSec + secondsRemaining,
        label: formatUpkeepRemaining(secondsRemaining),
        level: upkeepLevel(secondsRemaining),
      };
    } else {
      const expiry = Number(payload.protectionExpiry ?? payload.ProtectionExpiry ?? 0);
      upkeep = {
        secondsRemaining: 0,
        expiresAt: expiry > nowSec ? expiry : expiry > 0 ? nowSec + expiry : null,
        label: expiry > 0 ? "Expired" : "No upkeep data",
        level: "critical",
      };
    }
  }

  return {
    items,
    capacity,
    isToolCupboard: hasProtection,
    upkeep,
    tcStorage: hasProtection ? splitToolCupboardStorage(items) : undefined,
  };
}
