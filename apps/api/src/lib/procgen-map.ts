import type { ProcgenOverlayId } from "./procgen/types.js";
import { buildProcgenArtifacts } from "./procgen/parse.js";
import { eq } from "drizzle-orm";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Database } from "@rusttools/db";
import { rustServers } from "@rusttools/db";
import { parseServerMapMeta } from "@rusttools/shared";
import { env } from "../config.js";

export type ProcgenParseStatus = "pending" | "ready" | "error" | null;

export interface ProcgenMapStatus {
  uploaded: boolean;
  uploadedAt: string | null;
  parsedAt: string | null;
  parseStatus: ProcgenParseStatus;
  parseError: string | null;
  mapSeed: number | null;
  mapWorldSize: number | null;
  serverSeed: number | null;
  serverMapSize: number | null;
  seedMatch: boolean | null;
  sizeMatch: boolean | null;
  overlays: ProcgenOverlayId[];
}

const OVERLAY_IDS: ProcgenOverlayId[] = [
  "building-blocked",
  "heatmap-ores",
  "heatmap-stones",
  "heatmap-sulfur",
];

function procgenDir(serverId: string): string {
  return path.join(env.dataDir, "procgen", serverId);
}

function sourceMapPath(serverId: string): string {
  return path.join(procgenDir(serverId), "source.map");
}

function overlayPath(serverId: string, id: ProcgenOverlayId): string {
  return path.join(procgenDir(serverId), `overlay-${id}.png`);
}

function metaPath(serverId: string): string {
  return path.join(procgenDir(serverId), "meta.json");
}

function pathsPath(serverId: string): string {
  return path.join(procgenDir(serverId), "paths.json");
}

function prefabsPath(serverId: string): string {
  return path.join(procgenDir(serverId), "prefabs.json");
}

function heightPath(serverId: string): string {
  return path.join(procgenDir(serverId), "height.json");
}

export async function getProcgenMapStatus(
  db: Database,
  serverId: string,
  serverInfo?: Record<string, unknown> | null,
): Promise<ProcgenMapStatus> {
  const [server] = await db.select().from(rustServers).where(eq(rustServers.id, serverId)).limit(1);
  const mapMeta = serverInfo ? parseServerMapMeta(serverInfo) : null;

  const uploaded = Boolean(server?.mapFilePath);
  const parseStatus = (server?.mapParseStatus as ProcgenParseStatus) ?? null;

  return {
    uploaded,
    uploadedAt: server?.mapUploadedAt?.toISOString() ?? null,
    parsedAt: server?.mapParsedAt?.toISOString() ?? null,
    parseStatus,
    parseError: server?.mapParseError ?? null,
    mapSeed: server?.mapSeed ?? null,
    mapWorldSize: server?.mapWorldSize ?? null,
    serverSeed: mapMeta?.seed ?? null,
    serverMapSize: mapMeta?.mapSize ?? null,
    seedMatch:
      server?.mapSeed != null && mapMeta?.seed != null ? server.mapSeed === mapMeta.seed : null,
    sizeMatch:
      server?.mapWorldSize != null && mapMeta?.mapSize != null
        ? server.mapWorldSize === mapMeta.mapSize
        : null,
    overlays: parseStatus === "ready" ? OVERLAY_IDS : [],
  };
}

async function writeRgbaPng(filePath: string, rgba: Uint8Array, size: number): Promise<void> {
  await sharp(Buffer.from(rgba), {
    raw: { width: size, height: size, channels: 4 },
  })
    .png()
    .toFile(filePath);
}

export async function parseAndCacheProcgenMap(
  db: Database,
  serverId: string,
  mapBuffer: Buffer,
): Promise<void> {
  const dir = procgenDir(serverId);
  await mkdir(dir, { recursive: true });

  const sourcePath = sourceMapPath(serverId);
  await writeFile(sourcePath, mapBuffer);

  await db
    .update(rustServers)
    .set({
      mapFilePath: sourcePath,
      mapUploadedAt: new Date(),
      mapParseStatus: "pending",
      mapParseError: null,
      mapParsedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(rustServers.id, serverId));

  try {
    const parsed = buildProcgenArtifacts(mapBuffer);

    for (const overlayId of OVERLAY_IDS) {
      const rgba = parsed.overlays[overlayId];
      await writeRgbaPng(overlayPath(serverId, overlayId), rgba, parsed.overlaySize);
    }

    await writeFile(
      metaPath(serverId),
      JSON.stringify({
        worldSize: parsed.worldSize,
        version: parsed.version,
        overlaySize: parsed.overlaySize,
      }),
    );
    await writeFile(pathsPath(serverId), JSON.stringify(parsed.paths));
    await writeFile(prefabsPath(serverId), JSON.stringify(parsed.prefabs));
    await writeFile(heightPath(serverId), JSON.stringify(parsed.height));

    await db
      .update(rustServers)
      .set({
        mapSeed: null,
        mapWorldSize: parsed.worldSize,
        mapParseStatus: "ready",
        mapParseError: null,
        mapParsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(rustServers.id, serverId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse .map file";
    await db
      .update(rustServers)
      .set({
        mapParseStatus: "error",
        mapParseError: message,
        updatedAt: new Date(),
      })
      .where(eq(rustServers.id, serverId));
    throw err;
  }
}

export async function readProcgenOverlay(
  serverId: string,
  overlayId: ProcgenOverlayId,
): Promise<Buffer | null> {
  try {
    return await readFile(overlayPath(serverId, overlayId));
  } catch {
    return null;
  }
}

export async function readProcgenJson<T>(serverId: string, kind: "paths" | "prefabs" | "height" | "meta"): Promise<T | null> {
  const file =
    kind === "paths"
      ? pathsPath(serverId)
      : kind === "prefabs"
        ? prefabsPath(serverId)
        : kind === "height"
          ? heightPath(serverId)
          : metaPath(serverId);
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function deleteProcgenMap(db: Database, serverId: string): Promise<void> {
  await rm(procgenDir(serverId), { recursive: true, force: true });
  await db
    .update(rustServers)
    .set({
      mapFilePath: null,
      mapUploadedAt: null,
      mapSeed: null,
      mapWorldSize: null,
      mapParseStatus: null,
      mapParseError: null,
      mapParsedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(rustServers.id, serverId));
}
