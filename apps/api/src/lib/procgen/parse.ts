import { WorldData } from "rustworld";
import { BUILDING_BLOCKED_TOPOLOGY, ORE_TOPOLOGY, TerrainTopology } from "./topology.js";
import { TerrainBiome, TerrainSplat } from "./splat.js";
import { decompressLz4LegacyStream } from "./lz4-legacy-reader.js";
import { extractTerrainMesh, sampleTerrainChannel } from "./terrain.js";
import { rustworldLz4 as lz4 } from "./rustworld-lz4.js";
import type {
  ProcgenParseResult,
  ProcgenPath,
  ProcgenPrefabPoint,
  ProcgenOverlayId,
} from "./types.js";

/** Known cave / iceberg prefab id substrings (hex id matching). */
const CAVE_PREFAB_HINTS = ["cave", "tunnel", "underwater_lab"];
const ICEBERG_PREFAB_HINTS = ["iceberg", "ice_berg"];

const LZ4_FRAME_MAGIC = 0x184d2204;

/**
 * Bump when the parse pipeline changes in a way that invalidates cached
 * artifacts (height.json, overlays). Servers with older meta.json are
 * re-parsed from source.map on API startup.
 * v2: fixed misaligned terrain buffers corrupting heights on some maps.
 */
export const PROCGEN_PARSER_VERSION = 2;

interface RustWorldInstance {
  size: number;
  maps: Array<{ name: string; data: Uint8Array }>;
  prefabs: Array<{
    category: string;
    id: number;
    position?: { x: number; y: number; z: number };
  }>;
  paths: Array<{
    name?: string;
    width?: number;
    nodes?: Array<{ x: number; y: number; z: number }>;
  }>;
  getMapAsTerrain(map: string): TerrainMapLike | undefined;
}

interface TerrainMapLike {
  res: number;
  worldSize: number;
  data: Array<Uint8Array | Uint16Array | Uint32Array>;
  getChannel(channel: number): Uint8Array | Uint16Array | Uint32Array;
}

function readVersion(buffer: Buffer): number {
  if (buffer.byteLength < 4) return 0;
  return buffer.readUInt32LE(0);
}

function standaloneSlice(buffer: Buffer, offset: number): Uint8Array {
  const slice = buffer.subarray(offset);
  const copy = new Uint8Array(slice.length);
  copy.set(slice);
  return copy;
}

function decodeWorldData(payload: Uint8Array): RustWorldInstance {
  return WorldData.decode(payload) as RustWorldInstance;
}

function decompressWorldData(buffer: Buffer): Uint8Array {
  const version = readVersion(buffer);
  const offsets: number[] = [];

  // v10+ prepends an 8-byte timestamp after the 4-byte version header.
  if (version >= 10) offsets.push(12);
  offsets.push(4, 0);

  const errors: string[] = [];
  for (const offset of offsets) {
    try {
      const payload = decompressLz4LegacyStream(standaloneSlice(buffer, offset));
      if (payload.byteLength > 0) {
        decodeWorldData(payload);
        return payload;
      }
    } catch (err) {
      errors.push(
        `offset ${offset}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  for (const offset of [12, 4, 0]) {
    if (buffer.byteLength <= offset + 4) continue;
    if (buffer.readUInt32LE(offset) !== LZ4_FRAME_MAGIC) continue;
    try {
      const decoded = decodeStandardLz4Frame(standaloneSlice(buffer, offset));
      decodeWorldData(decoded);
      return decoded;
    } catch (err) {
      errors.push(
        `lz4 frame @${offset}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  throw new Error(
    `Failed to decompress .map file (version ${version}). ${errors.slice(0, 3).join("; ")}`,
  );
}

function decodeStandardLz4Frame(frame: Uint8Array): Uint8Array {
  if (frame.byteLength < 15) {
    throw new Error("LZ4 frame too short");
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  if (view.getUint32(0, true) !== LZ4_FRAME_MAGIC) {
    throw new Error("Missing LZ4 frame magic");
  }

  let offset = 4;
  const descriptor = view.getUint8(offset++);
  const blockMaxSize = (descriptor >> 4) & 0x7;
  const blockSizeMap = [0, 0, 0, 0, 65536, 262144, 1048576, 4194304] as const;
  const maxBlockSize = blockSizeMap[blockMaxSize] ?? 4194304;
  if (descriptor & 0x8) offset += 8;
  offset++;

  const chunks: Uint8Array[] = [];
  while (offset + 4 <= frame.byteLength) {
    const blockSize = view.getUint32(offset, true);
    offset += 4;
    if (blockSize === 0) break;

    const isUncompressed = (blockSize & 0x80000000) !== 0;
    const size = blockSize & 0x7fffffff;
    if (offset + size > frame.byteLength) {
      throw new Error("Truncated LZ4 frame block");
    }

    const block = frame.subarray(offset, offset + size);
    offset += size;
    if (descriptor & 0x10) offset++;

    if (isUncompressed) {
      chunks.push(block.slice());
    } else {
      const out = new Uint8Array(maxBlockSize);
      const written = lz4.decompressBlock(block, out, 0, block.length, 0);
      chunks.push(out.subarray(0, written));
    }
  }

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    merged.set(chunk, pos);
    pos += chunk.length;
  }
  return merged;
}

/**
 * Protobuf decodes `bytes` fields as views into the payload buffer at arbitrary
 * byte offsets. rustworld's TerrainMap "fixes" misalignment by shifting the read
 * start (up to 3 bytes) instead of copying, which pairs the wrong bytes into
 * every 16/32-bit sample and turns the terrain into noise. Whether this triggers
 * depends on the byte layout of the specific .map file, so some maps parse fine
 * and others come out corrupted. Copy each layer into a standalone buffer
 * (byteOffset 0) so the alignment hack never activates.
 */
function realignMapBuffers(world: RustWorldInstance): void {
  for (const map of world.maps ?? []) {
    if (map.data && map.data.byteOffset % 4 !== 0) {
      map.data = map.data.slice();
    }
  }
}

export function parseRustMapFile(buffer: Buffer): RustWorldInstance {
  const payload = decompressWorldData(buffer);
  const world = decodeWorldData(payload);
  realignMapBuffers(world);
  return world;
}

function overlayResolution(worldSize: number): number {
  return worldSize <= 2048 ? 1024 : 2048;
}

function createRgbaBuffer(size: number): Uint8Array {
  return new Uint8Array(size * size * 4);
}

function setPixel(rgba: Uint8Array, size: number, x: number, z: number, r: number, g: number, b: number, a: number): void {
  const idx = (z * size + x) * 4;
  rgba[idx] = r;
  rgba[idx + 1] = g;
  rgba[idx + 2] = b;
  rgba[idx + 3] = a;
}

function sampleSplatChannel(splat: TerrainMapLike, channel: number, x: number, z: number): number {
  return sampleTerrainChannel(splat, channel, x, z) / 255;
}

function sampleBiomeChannel(biome: TerrainMapLike, channel: number, x: number, z: number): number {
  return sampleTerrainChannel(biome, channel, x, z) / 255;
}

function sampleTopology(topology: TerrainMapLike, x: number, z: number): number {
  return sampleTerrainChannel(topology, 0, x, z);
}

function rasterBuildingBlocked(topology: TerrainMapLike, outSize: number): Uint8Array {
  const rgba = createRgbaBuffer(outSize);
  for (let z = 0; z < outSize; z++) {
    for (let x = 0; x < outSize; x++) {
      const wx = (x / outSize) * topology.worldSize;
      const wz = (z / outSize) * topology.worldSize;
      const value = sampleTopology(topology, wx, wz);
      if ((value & BUILDING_BLOCKED_TOPOLOGY) !== 0) {
        setPixel(rgba, outSize, x, z, 239, 68, 68, 140);
      }
    }
  }
  return rgba;
}

function rasterOreHeatmap(topology: TerrainMapLike, outSize: number): Uint8Array {
  const rgba = createRgbaBuffer(outSize);
  for (let z = 0; z < outSize; z++) {
    for (let x = 0; x < outSize; x++) {
      const wx = (x / outSize) * topology.worldSize;
      const wz = (z / outSize) * topology.worldSize;
      const value = sampleTopology(topology, wx, wz);
      if ((value & ORE_TOPOLOGY) !== 0) {
        const intensity = (value & TerrainTopology.DECOR) !== 0 ? 255 : 190;
        setPixel(rgba, outSize, x, z, 255, 128, 0, intensity);
      }
    }
  }
  return rgba;
}

function rasterStonesHeatmap(splat: TerrainMapLike, outSize: number): Uint8Array {
  const rgba = createRgbaBuffer(outSize);
  for (let z = 0; z < outSize; z++) {
    for (let x = 0; x < outSize; x++) {
      const wx = (x / outSize) * splat.worldSize;
      const wz = (z / outSize) * splat.worldSize;
      const stones = sampleSplatChannel(splat, TerrainSplat.STONES, wx, wz);
      if (stones > 0.08) {
        const a = Math.min(255, Math.floor(90 + stones * 220));
        setPixel(rgba, outSize, x, z, 230, 240, 255, a);
      }
    }
  }
  return rgba;
}

function rasterSulfurHeatmap(topology: TerrainMapLike, biome: TerrainMapLike, outSize: number): Uint8Array {
  const rgba = createRgbaBuffer(outSize);
  for (let z = 0; z < outSize; z++) {
    for (let x = 0; x < outSize; x++) {
      const wx = (x / outSize) * topology.worldSize;
      const wz = (z / outSize) * topology.worldSize;
      const topo = sampleTopology(topology, wx, wz);
      if ((topo & TerrainTopology.DECOR) === 0) continue;
      const arid = sampleBiomeChannel(biome, TerrainBiome.ARID, wx, wz);
      const tundra = sampleBiomeChannel(biome, TerrainBiome.TUNDRA, wx, wz);
      const score = Math.max(arid, tundra * 0.85);
      if (score > 0.12) {
        const a = Math.min(255, Math.floor(80 + score * 230));
        setPixel(rgba, outSize, x, z, 255, 235, 59, a);
      }
    }
  }
  return rgba;
}

function classifyPrefab(id: number, category: string): ProcgenPrefabPoint["kind"] {
  const idHex = id.toString(16).toLowerCase();
  const cat = category.toLowerCase();
  if (CAVE_PREFAB_HINTS.some((h) => cat.includes(h) || idHex.includes(h))) return "cave";
  if (ICEBERG_PREFAB_HINTS.some((h) => cat.includes(h) || idHex.includes(h))) return "iceberg";
  if (cat.includes("monument") || cat === "monument") return "monument";
  return "other";
}

function prefabLabel(kind: ProcgenPrefabPoint["kind"], category: string, id: number): string {
  if (kind === "cave") return "Cave entrance";
  if (kind === "iceberg") return "Iceberg";
  if (kind === "monument") return category || "Monument";
  return category || `Prefab ${id.toString(16)}`;
}

function extractPrefabs(world: RustWorldInstance): ProcgenPrefabPoint[] {
  const points: ProcgenPrefabPoint[] = [];
  for (const prefab of world.prefabs ?? []) {
    if (!prefab.position) continue;
    const kind = classifyPrefab(prefab.id, prefab.category ?? "");
    if (kind === "other") continue;
    points.push({
      id: prefab.id,
      category: prefab.category ?? "",
      kind,
      label: prefabLabel(kind, prefab.category ?? "", prefab.id),
      x: prefab.position.x,
      y: prefab.position.y,
      z: prefab.position.z,
    });
  }
  return points;
}

function extractPaths(world: RustWorldInstance): ProcgenPath[] {
  const paths: ProcgenPath[] = [];
  for (const path of world.paths ?? []) {
    const nodes = (path.nodes ?? []).map((n) => ({ x: n.x, y: n.y, z: n.z }));
    if (nodes.length < 2) continue;
    paths.push({
      name: path.name ?? "Path",
      width: path.width ?? 10,
      nodes,
    });
  }
  return paths;
}

export function buildProcgenArtifacts(buffer: Buffer): ProcgenParseResult {
  const world = parseRustMapFile(buffer);
  const version = readVersion(buffer);
  const topology = world.getMapAsTerrain("topology");
  const splat = world.getMapAsTerrain("splat");
  const biome = world.getMapAsTerrain("biome");
  const terrainMap = world.getMapAsTerrain("terrain");
  const waterMap = world.getMapAsTerrain("water");

  if (!topology || !splat || !biome || !terrainMap || !waterMap) {
    throw new Error("Map file is missing required terrain layers (topology, splat, biome, terrain, water)");
  }

  const overlaySize = overlayResolution(world.size);
  const overlays: Record<ProcgenOverlayId, Uint8Array> = {
    "building-blocked": rasterBuildingBlocked(topology, overlaySize),
    "heatmap-ores": rasterOreHeatmap(topology, overlaySize),
    "heatmap-stones": rasterStonesHeatmap(splat, overlaySize),
    "heatmap-sulfur": rasterSulfurHeatmap(topology, biome, overlaySize),
  };

  return {
    worldSize: world.size,
    version,
    overlays,
    overlaySize,
    paths: extractPaths(world),
    prefabs: extractPrefabs(world),
    height: extractTerrainMesh(terrainMap, splat, waterMap, topology),
  };
}
