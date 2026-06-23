import { calculateRecycle, type ContainerItem } from "@rusttools/shared";
import type { RustPlusManager } from "@rusttools/rustplus-client";

export interface VendingListing {
  name: string;
  x: number;
  y: number;
  item: string;
  quantity: number;
  costItem: string;
  costQuantity: number;
}

const MARKER_VENDING = 3;

export function parseVendingMarkers(markers: unknown): VendingListing[] {
  const data = markers as {
    markers?: Array<{
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
    for (const order of marker.sellOrders ?? []) {
      results.push({
        name: marker.name ?? "Vending",
        x: marker.x ?? 0,
        y: marker.y ?? 0,
        item: String(order.itemId ?? "unknown"),
        quantity: order.amountInStock ?? order.quantity ?? 0,
        costItem: String(order.currencyId ?? "unknown"),
        costQuantity: order.costPerItem ?? 0,
      });
    }
  }
  return results;
}

export function searchVending(markers: unknown, query: string): VendingListing[] {
  const q = query.toLowerCase();
  return parseVendingMarkers(markers).filter(
    (v) =>
      v.name.toLowerCase().includes(q) ||
      v.item.toLowerCase().includes(q) ||
      v.costItem.toLowerCase().includes(q),
  );
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

export function extractContainerItems(info: unknown): ContainerItem[] {
  const data = info as {
    payload?: { items?: ContainerItem[] };
    items?: ContainerItem[];
  };
  return data.payload?.items ?? data.items ?? [];
}

export function recycleFromEntityInfo(info: unknown) {
  return calculateRecycle(extractContainerItems(info));
}
