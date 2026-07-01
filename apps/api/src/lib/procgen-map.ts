import type { ProcgenOverlayId } from "./procgen/types.js";
import { runProcgenParseInSubprocess } from "./procgen-subprocess.js";
import { eq } from "drizzle-orm";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "@rusttools/db";
import { rustServers } from "@rusttools/db";
import { env } from "../config.js";

/** Parse can take many minutes; pending older than this is treated as stuck. */
const PARSE_STALE_MS = 22 * 60_000;

const procgenParseInFlight = new Set<string>();

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

async function procgenMetaExists(serverId: string): Promise<boolean> {
  try {
    await access(metaPath(serverId));
    return true;
  } catch {
    return false;
  }
}

async function recoverStuckProcgenParse(
  db: Database,
  server: typeof rustServers.$inferSelect,
): Promise<typeof rustServers.$inferSelect> {
  if (server.mapParseStatus !== "pending" || !server.mapUploadedAt) {
    return server;
  }

  const ageMs = Date.now() - server.mapUploadedAt.getTime();
  if (ageMs < PARSE_STALE_MS) {
    return server;
  }

  if (await procgenMetaExists(server.id)) {
    return server;
  }

  const message = "Parse timed out or was interrupted (for example after an API restart). Upload the .map file again.";
  await db
    .update(rustServers)
    .set({
      mapParseStatus: "error",
      mapParseError: message,
      updatedAt: new Date(),
    })
    .where(eq(rustServers.id, server.id));

  return { ...server, mapParseStatus: "error", mapParseError: message };
}

export async function getProcgenMapStatus(
  db: Database,
  serverId: string,
): Promise<ProcgenMapStatus> {
  const [row] = await db.select().from(rustServers).where(eq(rustServers.id, serverId)).limit(1);
  const server = row ? await recoverStuckProcgenParse(db, row) : null;

  const uploaded = Boolean(server?.mapFilePath);
  const parseStatus = (server?.mapParseStatus as ProcgenParseStatus) ?? null;
  const parsing = procgenParseInFlight.has(serverId);

  return {
    uploaded,
    uploadedAt: server?.mapUploadedAt?.toISOString() ?? null,
    parsedAt: server?.mapParsedAt?.toISOString() ?? null,
    parseStatus: parsing && parseStatus !== "ready" ? "pending" : parseStatus,
    parseError: server?.mapParseError ?? null,
    mapSeed: server?.mapSeed ?? null,
    mapWorldSize: server?.mapWorldSize ?? null,
    serverSeed: server?.trackedMapSeed ?? null,
    serverMapSize: server?.rustMapSize ?? server?.mapWorldSize ?? null,
    seedMatch:
      server?.mapSeed != null && server?.trackedMapSeed != null
        ? server.mapSeed === server.trackedMapSeed
        : null,
    sizeMatch:
      server?.mapWorldSize != null && (server?.rustMapSize ?? server?.mapWorldSize) != null
        ? server.mapWorldSize === (server.rustMapSize ?? server.mapWorldSize)
        : null,
    overlays: parseStatus === "ready" ? OVERLAY_IDS : [],
  };
}

export async function stageProcgenMapUpload(
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
}

export function scheduleProcgenMapParse(db: Database, serverId: string): void {
  if (procgenParseInFlight.has(serverId)) return;
  procgenParseInFlight.add(serverId);
  void runProcgenMapParse(db, serverId).finally(() => {
    procgenParseInFlight.delete(serverId);
  });
}

/** Re-queue parses that were interrupted by an API restart. */
export async function resumePendingProcgenParses(db: Database): Promise<void> {
  const rows = await db
    .select()
    .from(rustServers)
    .where(eq(rustServers.mapParseStatus, "pending"));

  for (const server of rows) {
    if (await procgenMetaExists(server.id)) {
      await db
        .update(rustServers)
        .set({
          mapParseStatus: "ready",
          mapParsedAt: server.mapParsedAt ?? new Date(),
          mapParseError: null,
          updatedAt: new Date(),
        })
        .where(eq(rustServers.id, server.id));
      continue;
    }

    try {
      await access(sourceMapPath(server.id));
    } catch {
      await db
        .update(rustServers)
        .set({
          mapParseStatus: "error",
          mapParseError: "Uploaded .map file is missing — upload again.",
          updatedAt: new Date(),
        })
        .where(eq(rustServers.id, server.id));
      continue;
    }

    scheduleProcgenMapParse(db, server.id);
  }
}

async function runProcgenMapParse(db: Database, serverId: string): Promise<void> {
  const dir = procgenDir(serverId);
  const sourcePath = sourceMapPath(serverId);

  try {
    await runProcgenParseInSubprocess(sourcePath, dir);

    const meta = await readProcgenJson<{ worldSize: number }>(serverId, "meta");
    const worldSize = meta?.worldSize ?? null;

    await db
      .update(rustServers)
      .set({
        mapSeed: null,
        mapWorldSize: worldSize,
        rustMapSize: worldSize ?? undefined,
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

export async function parseAndCacheProcgenMap(
  db: Database,
  serverId: string,
  mapBuffer: Buffer,
): Promise<void> {
  await stageProcgenMapUpload(db, serverId, mapBuffer);
  await runProcgenMapParse(db, serverId);
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
