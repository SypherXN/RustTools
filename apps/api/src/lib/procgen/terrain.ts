import type { ProcgenHeightData } from "./types.js";
import { TerrainTopology } from "./topology.js";
export const TERRAIN_HEIGHT_SCALE = 1000;
export const TERRAIN_HEIGHT_OFFSET = -500;

/** Web mesh resolution — balances fidelity vs payload size. */
export const TERRAIN_MESH_RESOLUTION = 1024;
const SHORT_FLOAT_SCALE = 32766;

/** RGB weights for splat channels (dirt, snow, sand, rock, grass, forest, stones, gravel). */
const SPLAT_RGB: ReadonlyArray<readonly [number, number, number]> = [
  [139, 105, 20],
  [245, 245, 255],
  [194, 178, 128],
  [107, 107, 107],
  [74, 124, 63],
  [45, 80, 22],
  [128, 128, 130],
  [158, 139, 110],
];

export function terrainIndex(worldSize: number, x: number, z: number): number {
  return z * worldSize + x;
}

export function heightRawToWorldY(raw: number): number {
  const signed = raw > 32767 ? raw - 65536 : raw;
  return (signed / SHORT_FLOAT_SCALE) * TERRAIN_HEIGHT_SCALE + TERRAIN_HEIGHT_OFFSET;
}

function sampleChannel(
  data: Uint8Array | Uint16Array | Uint32Array,
  worldSize: number,
  wx: number,
  wz: number,
): number {
  const x = Math.min(worldSize - 1, Math.max(0, Math.floor(wx)));
  const z = Math.min(worldSize - 1, Math.max(0, Math.floor(wz)));
  return data[terrainIndex(worldSize, x, z)] as number;
}

function sampleChannelBilinear(
  data: Uint8Array | Uint16Array | Uint32Array,
  worldSize: number,
  wx: number,
  wz: number,
): number {
  const max = worldSize - 1;
  const fx = Math.min(max, Math.max(0, (wx / worldSize) * max));
  const fz = Math.min(max, Math.max(0, (wz / worldSize) * max));
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(max, x0 + 1);
  const z1 = Math.min(max, z0 + 1);
  const tx = fx - x0;
  const tz = fz - z0;

  const h00 = data[terrainIndex(worldSize, x0, z0)] as number;
  const h10 = data[terrainIndex(worldSize, x1, z0)] as number;
  const h01 = data[terrainIndex(worldSize, x0, z1)] as number;
  const h11 = data[terrainIndex(worldSize, x1, z1)] as number;

  const top = h00 * (1 - tx) + h10 * tx;
  const bottom = h01 * (1 - tx) + h11 * tx;
  return top * (1 - tz) + bottom * tz;
}

export function sampleTerrainWorldY(
  heightChannel: Uint8Array | Uint16Array | Uint32Array,
  worldSize: number,
  wx: number,
  wz: number,
): number {
  return heightRawToWorldY(sampleChannelBilinear(heightChannel, worldSize, wx, wz));
}

export function sampleSplatColor(
  splatChannels: Array<Uint8Array | Uint16Array | Uint32Array>,
  worldSize: number,
  wx: number,
  wz: number,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let weightSum = 0;

  for (let channel = 0; channel < SPLAT_RGB.length; channel++) {
    const data = splatChannels[channel];
    if (!data) continue;
    const weight = sampleChannel(data, worldSize, wx, wz) / 255;
    if (weight <= 0) continue;
    const [cr, cg, cb] = SPLAT_RGB[channel]!;
    r += cr * weight;
    g += cg * weight;
    b += cb * weight;
    weightSum += weight;
  }

  if (weightSum <= 0) {
    return [74, 124, 63];
  }

  return [
    Math.round(r / weightSum),
    Math.round(g / weightSum),
    Math.round(b / weightSum),
  ];
}

export interface TerrainMapLike {
  worldSize: number;
  getChannel(channel: number): Uint8Array | Uint16Array | Uint32Array;
}

const ZERO_LEVEL_OCEAN_TOPOLOGY = TerrainTopology.OCEAN;
const MIN_ENCODED_WATER_RAW = 1000;

function waterRawToWorldY(raw: number, hasWaterTopology: boolean): number | null {
  if (raw >= MIN_ENCODED_WATER_RAW) {
    const waterY = heightRawToWorldY(raw);
    if (waterY < -100) return hasWaterTopology ? 0 : null;
    return waterY;
  }
  // Rust's ocean plane is zero-level water; modern water maps may omit it from the raw water layer.
  // Do not use broad lake/offshore/river topology as a fallback, because it can cover large land areas.
  return hasWaterTopology ? 0 : null;
}

export function extractTerrainMesh(
  terrainMap: TerrainMapLike,
  splatMap: TerrainMapLike,
  waterMap: TerrainMapLike,
  topologyMap: TerrainMapLike,
): ProcgenHeightData {
  const worldSize = terrainMap.worldSize;
  const heightChannel = terrainMap.getChannel(0);
  const waterChannel = waterMap.getChannel(0);
  const topologyChannel = topologyMap.getChannel(0);
  const splatChannels = Array.from({ length: 8 }, (_, channel) => splatMap.getChannel(channel));
  const resolution = Math.min(TERRAIN_MESH_RESOLUTION, worldSize);
  const heights: number[] = new Array(resolution * resolution);
  const water: Array<number | null> = new Array(resolution * resolution);
  const colors: number[] = new Array(resolution * resolution * 3);
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;

  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const wx = (x / (resolution - 1)) * worldSize;
      const wz = (z / (resolution - 1)) * worldSize;
      const worldY = sampleTerrainWorldY(heightChannel, worldSize, wx, wz);
      const topology = sampleChannel(topologyChannel, worldSize, wx, wz);
      const waterY = waterRawToWorldY(
        sampleChannelBilinear(waterChannel, worldSize, wx, wz),
        (topology & ZERO_LEVEL_OCEAN_TOPOLOGY) !== 0,
      );
      const [r, g, b] = sampleSplatColor(splatChannels, worldSize, wx, wz);
      const idx = z * resolution + x;
      heights[idx] = worldY;
      water[idx] = waterY;
      colors[idx * 3] = r;
      colors[idx * 3 + 1] = g;
      colors[idx * 3 + 2] = b;
      if (worldY < minHeight) minHeight = worldY;
      if (worldY > maxHeight) maxHeight = worldY;
    }
  }

  return {
    resolution,
    worldSize,
    heights,
    water,
    colors,
    minHeight: Number.isFinite(minHeight) ? minHeight : TERRAIN_HEIGHT_OFFSET,
    maxHeight: Number.isFinite(maxHeight) ? maxHeight : TERRAIN_HEIGHT_OFFSET + TERRAIN_HEIGHT_SCALE,
  };
}

/** Sample any terrain layer at world X/Z using Facepunch row-major indexing. */
export function sampleTerrainChannel(
  terrain: TerrainMapLike,
  channel: number,
  wx: number,
  wz: number,
): number {
  const size = terrain.worldSize;
  const data = terrain.getChannel(channel);
  return sampleChannel(data, size, wx, wz);
}
