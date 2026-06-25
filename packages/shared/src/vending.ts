import { resolveRustItem } from "./rust-items.js";

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

export interface VendingSearchFilters {
  /** Match cost currency by shortname or display name (substring, case-insensitive). */
  currency?: string;
  minPrice?: number;
  maxPrice?: number;
  /** Minimum % below the median price for the same item (0–100). */
  minProfitMargin?: number;
  inStockOnly?: boolean;
}

export type VendingSearchSort = "price" | "margin";

export interface VendingSearchResult extends VendingListing {
  profitMarginPercent: number | null;
  medianPrice: number | null;
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

export function parseVendingMarkers(markers: unknown): VendingListing[] {
  const data = markers as {
    markers?: Array<{
      id?: number;
      type?: number;
      name?: string;
      x?: number;
      y?: number;
      sellOrders?: RawSellOrder[];
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

function listingMatchesCurrency(listing: VendingListing, currency: string): boolean {
  const q = currency.trim().toLowerCase();
  if (!q) return true;
  return (
    listing.costItemShortname.toLowerCase().includes(q) ||
    listing.costItemName.toLowerCase().includes(q) ||
    listing.costItem.includes(q)
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function medianPriceByItem(listings: VendingListing[]): Map<string, number> {
  const prices = new Map<string, number[]>();
  for (const listing of listings) {
    if (listing.costQuantity <= 0) continue;
    const key = listing.itemShortname || listing.item;
    const bucket = prices.get(key) ?? [];
    bucket.push(listing.costQuantity);
    prices.set(key, bucket);
  }

  const medians = new Map<string, number>();
  for (const [key, values] of prices) {
    const value = median(values);
    if (value != null) medians.set(key, value);
  }
  return medians;
}

export function profitMarginPercent(price: number, medianPrice: number | null): number | null {
  if (medianPrice == null || medianPrice <= 0 || price <= 0) return null;
  if (price >= medianPrice) return 0;
  return Math.round(((medianPrice - price) / medianPrice) * 100);
}

export function enrichVendingSearchResults(listings: VendingListing[]): VendingSearchResult[] {
  const medians = medianPriceByItem(listings);
  return listings.map((listing) => {
    const key = listing.itemShortname || listing.item;
    const medianPrice = medians.get(key) ?? null;
    return {
      ...listing,
      medianPrice,
      profitMarginPercent: profitMarginPercent(listing.costQuantity, medianPrice),
    };
  });
}

export function applyVendingSearchFilters(
  listings: VendingSearchResult[],
  filters: VendingSearchFilters,
): VendingSearchResult[] {
  const inStockOnly = filters.inStockOnly !== false;

  return listings.filter((listing) => {
    if (inStockOnly && listing.quantity <= 0) return false;
    if (filters.currency && !listingMatchesCurrency(listing, filters.currency)) return false;
    if (filters.minPrice != null && listing.costQuantity < filters.minPrice) return false;
    if (filters.maxPrice != null && listing.costQuantity > filters.maxPrice) return false;
    if (filters.minProfitMargin != null && filters.minProfitMargin > 0) {
      const margin = listing.profitMarginPercent;
      if (margin == null || margin < filters.minProfitMargin) return false;
    }
    return true;
  });
}

export function sortVendingSearchResults(
  listings: VendingSearchResult[],
  sort: VendingSearchSort | undefined,
): VendingSearchResult[] {
  if (!sort) return listings;

  const sorted = [...listings];
  if (sort === "price") {
    sorted.sort((a, b) => a.costQuantity - b.costQuantity || a.name.localeCompare(b.name));
  } else if (sort === "margin") {
    sorted.sort((a, b) => {
      const ma = a.profitMarginPercent ?? -1;
      const mb = b.profitMarginPercent ?? -1;
      return mb - ma || a.costQuantity - b.costQuantity;
    });
  }
  return sorted;
}

export function searchVendingListings(
  markers: unknown,
  query: string | undefined,
  filters: VendingSearchFilters = {},
  sort?: VendingSearchSort,
): VendingSearchResult[] {
  const q = query?.trim() ?? "";
  let listings = enrichVendingSearchResults(parseVendingMarkers(markers));

  if (q) {
    listings = listings.filter((listing) => listingMatchesQuery(listing, q));
  }

  listings = applyVendingSearchFilters(listings, filters);
  return sortVendingSearchResults(listings, sort);
}

export function hasVendingSearchInput(
  query: string | undefined,
  filters: VendingSearchFilters,
): boolean {
  if (query?.trim()) return true;
  if (filters.currency?.trim()) return true;
  if (filters.minPrice != null) return true;
  if (filters.maxPrice != null) return true;
  if (filters.minProfitMargin != null && filters.minProfitMargin > 0) return true;
  return false;
}
