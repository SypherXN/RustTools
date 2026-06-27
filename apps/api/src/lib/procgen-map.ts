import type { ProcgenOverlayId } from "./procgen/types.js";
import { runProcgenParseInSubprocess } from "./procgen-subprocess.js";
import { eq } from "drizzle-orm";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
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

/** Remove all procgen files for a server from disk (safe if already absent). */
export async function removeProcgenServerDir(serverId: string): Promise<void> {
  await rm(procgenDir(serverId), { recursive: true, force: true });
}

const PARSE_ARTIFACT_NAMES = [
  "meta.json",
  "paths.json",
  "prefabs.json",
  "height.json",
  "overlay-building-blocked.png",
  "overlay-heatmap-ores.png",
  "overlay-heatmap-stones.png",
  "overlay-heatmap-sulfur.png",
] as const;

/** Drop generated parse files but keep source.map (failed parse cleanup). */
async function removeProcgenParseArtifacts(serverId: string): Promise<void> {
  const dir = procgenDir(serverId);
  await Promise.all(
    PARSE_ARTIFACT_NAMES.map((name) => rm(path.join(dir, name), { force: true })),
  );
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

export async function parseAndCacheProcgenMap(
  db: Database,
  serverId: string,
  mapBuffer: Buffer,
): Promise<void> {
  await removeProcgenServerDir(serverId);

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
    await runProcgenParseInSubprocess(sourcePath, dir);

    const meta = await readProcgenJson<{ worldSize: number }>(serverId, "meta");
    const worldSize = meta?.worldSize ?? null;

    await db
      .update(rustServers)
      .set({
        mapSeed: null,
        mapWorldSize: worldSize,
        mapParseStatus: "ready",
        mapParseError: null,
        mapParsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(rustServers.id, serverId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse .map file";
    await removeProcgenParseArtifacts(serverId);
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
  await removeProcgenServerDir(serverId);
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
