/** Common Rust recycle yields (scrap from recycler). Extend as needed. */
export const RECYCLE_YIELDS: Record<string, { scrap: number; extra?: Record<string, number> }> = {
  "rifle.ak": { scrap: 50, extra: { "metal.refined": 1, "metal.fragments": 25 } },
  "rifle.bolt": { scrap: 30 },
  "smg.mp5": { scrap: 20 },
  "pistol.python": { scrap: 15 },
  "metal.refined": { scrap: 0 },
  "metal.fragments": { scrap: 0 },
  "wood": { scrap: 0 },
  "stones": { scrap: 0 },
  "sulfur": { scrap: 0 },
  "metal.ore": { scrap: 0 },
  "hq.metal.ore": { scrap: 0 },
  "cloth": { scrap: 0 },
  "leather": { scrap: 0 },
  "lowgradefuel": { scrap: 0 },
  "explosive.timed": { scrap: 15 },
  "ammo.rifle": { scrap: 1 },
  "ammo.rifle.hv": { scrap: 1 },
  "ammo.rifle.incendiary": { scrap: 1 },
  "ammo.rifle.explosive": { scrap: 2 },
  "syringe.medical": { scrap: 2 },
  "largemedkit": { scrap: 5 },
};

export interface ContainerItem {
  itemId?: number;
  shortname?: string;
  quantity?: number;
  itemIsBlueprint?: boolean;
}

export function calculateRecycle(items: ContainerItem[]): {
  scrap: number;
  extras: Record<string, number>;
} {
  let scrap = 0;
  const extras: Record<string, number> = {};

  for (const item of items) {
    const key = item.shortname ?? String(item.itemId ?? "");
    const qty = item.quantity ?? 1;
    const yield_ = RECYCLE_YIELDS[key];
    if (!yield_) continue;
    scrap += yield_.scrap * qty;
    if (yield_.extra) {
      for (const [name, amount] of Object.entries(yield_.extra)) {
        extras[name] = (extras[name] ?? 0) + amount * qty;
      }
    }
  }

  return { scrap, extras };
}
