export const TerrainSplat = {
  DIRT: 0,
  SNOW: 1,
  SAND: 2,
  ROCK: 3,
  GRASS: 4,
  FOREST: 5,
  STONES: 6,
  GRAVEL: 7,
} as const;

export const TerrainBiome = {
  ARID: 0,
  TEMPERATE: 1,
  TUNDRA: 2,
  ARCTIC: 3,
  /** Present on Jungle-era maps; missing on older biome layers. */
  JUNGLE: 4,
} as const;
