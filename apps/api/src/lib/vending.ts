import {
  calculateRecycle,
  extractContainerItems,
  searchVendingListings,
  type VendingSearchFilters,
  type VendingSearchSort,
} from "@rusttools/shared";
import type { RustPlusManager } from "@rusttools/rustplus-client";

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
): Promise<boolean | null> {
  try {
    const info = (await rustPlus.getEntityInfo(entityId)) as {
      payload?: { value?: boolean };
      value?: boolean;
    };
    return info.payload?.value ?? info.value ?? null;
  } catch {
    return null;
  }
}

export function recycleFromEntityInfo(info: unknown) {
  return calculateRecycle(extractContainerItems(info));
}
