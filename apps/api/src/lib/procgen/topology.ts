/** Rust TerrainTopology bit flags (powers of two). */
export const TerrainTopology = {
  FIELD: 1 << 0,
  CLIFF: 1 << 1,
  SUMMIT: 1 << 2,
  BEACHSIDE: 1 << 3,
  BEACH: 1 << 4,
  FOREST: 1 << 5,
  FORESTSIDE: 1 << 6,
  OCEAN: 1 << 7,
  OCEANSIDE: 1 << 8,
  DECOR: 1 << 9,
  MONUMENT: 1 << 10,
  ROAD: 1 << 11,
  ROADSIDE: 1 << 12,
  SWAMP: 1 << 13,
  RIVER: 1 << 14,
  RIVERSIDE: 1 << 15,
  LAKE: 1 << 16,
  LAKESIDE: 1 << 17,
  OFFSHORE: 1 << 18,
  RAIL: 1 << 19,
  RAILSIDE: 1 << 20,
  BUILDING: 1 << 21,
  CLIFFSIDE: 1 << 22,
  MOUNTAIN: 1 << 23,
  CLUTTER: 1 << 24,
} as const;

/** Cells where building privilege / foundations are blocked. */
export const BUILDING_BLOCKED_TOPOLOGY =
  TerrainTopology.CLIFF |
  TerrainTopology.SUMMIT |
  TerrainTopology.OCEAN |
  TerrainTopology.MONUMENT |
  TerrainTopology.ROAD |
  TerrainTopology.RAIL |
  TerrainTopology.RIVER |
  TerrainTopology.LAKE |
  TerrainTopology.BUILDING;

/** Ore node spawn topology. */
export const ORE_TOPOLOGY = TerrainTopology.DECOR | TerrainTopology.CLIFFSIDE;
