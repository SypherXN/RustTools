import items from "./data/rust-items.json" with { type: "json" };

export interface RustItemInfo {
  shortname: string;
  name: string;
}

const byId = items as Record<string, RustItemInfo>;

export function lookupRustItem(itemId: string | number): RustItemInfo | undefined {
  return byId[String(itemId)];
}

export function formatRustItem(itemId: string | number): string {
  const item = lookupRustItem(itemId);
  if (!item) return String(itemId);
  return item.name || item.shortname;
}

export function resolveRustItem(itemId: string | number): {
  id: string;
  shortname: string;
  name: string;
} {
  const id = String(itemId);
  const item = lookupRustItem(id);
  return {
    id,
    shortname: item?.shortname ?? id,
    name: item?.name ?? id,
  };
}
