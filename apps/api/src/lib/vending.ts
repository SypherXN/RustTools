import {
  calculateRecycle,
  extractContainerItems,
  resolveRustItem,
} from "@rusttools/shared";
import type { RustPlusManager } from "@rusttools/rustplus-client";

export interface SellOrderListing {
  item: string;
  itemName: string;
  itemShortname: string;
  quantity: number;
  costItem: string;
  costItemName: string;
  costItemShortname: string;
  costQuantity: number;
}

export interface VendingListing extends SellOrderListing {
  markerId: string;
  name: string;
  x: number;
  y: number;
}

const MARKER_VENDING = 3;

type RawSellOrder = {
  itemId?: number;
  quantity?: number;
  currencyId?: number;
  costPerItem?: number;
  amountInStock?: number;
};

export function parseSellOrders(orders: RawSellOrder[] | undefined): SellOrderListing[] {
  return (orders ?? []).map((order) => {
    const item = resolveRustItem(order.itemId ?? "unknown");
    const costItem = resolveRustItem(order.currencyId ?? "unknown");
    return {
      item: item.id,
      itemName: item.name,
      itemShortname: item.shortname,
      quantity: order.amountInStock ?? order.quantity ?? 0,
      costItem: costItem.id,
      costItemName: costItem.name,
      costItemShortname: costItem.shortname,
      costQuantity: order.costPerItem ?? 0,
    };
  });
}

function listingMatchesQuery(listing: VendingListing, query: string): boolean {
  const q = query.toLowerCase();
  return (
    listing.name.toLowerCase().includes(q) ||
    listing.item.includes(q) ||
    listing.itemName.toLowerCase().includes(q) ||
    listing.itemShortname.toLowerCase().includes(q) ||
    listing.costItem.includes(q) ||
    listing.costItemName.toLowerCase().includes(q) ||
    listing.costItemShortname.toLowerCase().includes(q)
  );
}

export function parseVendingMarkers(markers: unknown): VendingListing[] {
  const data = markers as {
    markers?: Array<{
      id?: number;
      type?: number;
      name?: string;
      x?: number;
      y?: number;
      sellOrders?: Array<{
        itemId?: number;
        quantity?: number;
        currencyId?: number;
        costPerItem?: number;
        amountInStock?: number;
      }>;
    }>;
  };

  const results: VendingListing[] = [];
  for (const marker of data.markers ?? []) {
    if (marker.type !== MARKER_VENDING) continue;
    const markerId =
      marker.id != null
        ? `marker-${marker.id}`
        : `marker-${marker.type}-${marker.x}-${marker.y}`;
    for (const order of parseSellOrders(marker.sellOrders)) {
      results.push({
        markerId,
        name: marker.name ?? "Vending",
        x: marker.x ?? 0,
        y: marker.y ?? 0,
        ...order,
      });
    }
  }
  return results;
}

export function searchVending(markers: unknown, query: string): VendingListing[] {
  const q = query.trim();
  if (!q) return [];
  return parseVendingMarkers(markers).filter((listing) => listingMatchesQuery(listing, q));
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
