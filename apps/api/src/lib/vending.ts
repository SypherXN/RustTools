import {
  calculateRecycle,
  extractContainerItems,
  searchVendingListings,
  type VendingSearchFilters,
  type VendingSearchSort,
} from "@rusttools/shared";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { parseSwitchEntityValue } from "@rusttools/shared";

export {
  parseSellOrders,
  parseVendingMarkers,
  searchVendingListings,
  type SellOrderListing,
  type VendingListing,
  type VendingSearchFilters,
  type VendingSearchResult,
  type VendingSearchSort,
} from "@rusttools/shared";

export function searchVending(
  markers: unknown,
  query: string | undefined,
  filters: VendingSearchFilters = {},
  sort?: VendingSearchSort,
) {
  return searchVendingListings(markers, query, filters, sort);
}

export async function getSwitchState(
  rustPlus: RustPlusManager,
  entityId: number,
  cachedInfo?: unknown,
): Promise<boolean | null> {
  try {
    const info = cachedInfo ?? (await rustPlus.getEntityInfo(entityId));
    return parseSwitchEntityValue(info);
  } catch {
    return null;
  }
}

export type SwitchAction = "on" | "off" | "toggle";

/** Resolve the target ON/OFF state from an explicit action, boolean value, or toggle. */
export async function resolveSwitchTargetValue(
  rustPlus: RustPlusManager,
  entityId: number,
  options: { action?: SwitchAction; value?: boolean },
): Promise<boolean> {
  if (options.action === "on") return true;
  if (options.action === "off") return false;
  if (options.action === "toggle") {
    const current = await getSwitchState(rustPlus, entityId);
    return current === null ? true : !current;
  }
  if (typeof options.value === "boolean") return options.value;
  const current = await getSwitchState(rustPlus, entityId);
  return current === null ? true : !current;
}

export function recycleFromEntityInfo(info: unknown) {
  return calculateRecycle(extractContainerItems(info));
}
