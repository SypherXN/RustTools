import type { StorageItemView } from "./storage.js";

export interface StorageItemSearchMonitorHit {
  id: string;
  name: string;
  entityId: number;
  quantity: number;
}

export interface StorageItemSearchMatch {
  itemId: number;
  shortname: string;
  name: string;
  iconUrl: string;
  total: number;
  monitors: StorageItemSearchMonitorHit[];
}

export function itemMatchesStorageQuery(
  item: Pick<StorageItemView, "itemId" | "shortname" | "name">,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (String(item.itemId) === q) return true;
  if (item.shortname.toLowerCase().includes(q)) return true;
  if (item.name.toLowerCase().includes(q)) return true;
  return false;
}

export function aggregateStorageItemSearch(
  monitorResults: Array<{
    id: string;
    name: string;
    entityId: number;
    items: StorageItemView[];
  }>,
  query: string,
): StorageItemSearchMatch[] {
  const q = query.trim();
  if (!q) return [];

  const buckets = new Map<string, StorageItemSearchMatch>();

  for (const monitor of monitorResults) {
    for (const item of monitor.items) {
      if (!itemMatchesStorageQuery(item, q)) continue;

      const key = String(item.itemId);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          itemId: item.itemId,
          shortname: item.shortname,
          name: item.name,
          iconUrl: item.iconUrl,
          total: 0,
          monitors: [],
        };
        buckets.set(key, bucket);
      }

      bucket.total += item.quantity;
      const existing = bucket.monitors.find((hit) => hit.id === monitor.id);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        bucket.monitors.push({
          id: monitor.id,
          name: monitor.name,
          entityId: monitor.entityId,
          quantity: item.quantity,
        });
      }
    }
  }

  return [...buckets.values()].sort((a, b) => b.total - a.total);
}
