import { and, eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustServers } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { isHiddenTeamPosition, type ParsedTeamInfo, type TeamRosterMember } from "@rusttools/shared";
import { getActiveFcmCredential } from "./fcm-credentials.js";

export type { TeamRosterMember, ParsedTeamInfo };

export async function getActiveServerId(db: Database): Promise<string | null> {
  const server = await getActiveServer(db);
  return server?.id ?? null;
}

export async function getActiveServer(
  db: Database,
): Promise<{ id: string; playerId: string } | null> {
  const activeFcm = await getActiveFcmCredential(db);
  if (!activeFcm) return null;

  const [server] = await db
    .select({ id: rustServers.id, playerId: rustServers.playerId })
    .from(rustServers)
    .where(
      and(eq(rustServers.isActive, true), eq(rustServers.fcmCredentialId, activeFcm.id)),
    )
    .limit(1);
  return server ?? null;
}

export function parseWipeCountdown(info: unknown): {
  wipeAt: number | null;
  secondsRemaining: number | null;
  label: string;
} {
  const data = info as { wipeTime?: number; wipe?: number };
  const wipeAt = data.wipeTime ?? data.wipe ?? null;
  if (!wipeAt) {
    return { wipeAt: null, secondsRemaining: null, label: "Unknown" };
  }
  const secondsRemaining = Math.max(0, wipeAt - Math.floor(Date.now() / 1000));
  const days = Math.floor(secondsRemaining / 86400);
  const hours = Math.floor((secondsRemaining % 86400) / 3600);
  return {
    wipeAt,
    secondsRemaining,
    label: days > 0 ? `${days}d ${hours}h` : `${hours}h ${Math.floor((secondsRemaining % 3600) / 60)}m`,
  };
}

export function getWorldSize(info: unknown): number | undefined {
  const mapSize = (info as { mapSize?: number })?.mapSize;
  return mapSize && mapSize > 0 ? mapSize : undefined;
}

/** Prefer cached map size so map pages do not block on a fresh getInfo when Rust+ is busy. */
export async function resolveWorldSize(
  rustPlus: RustPlusManager,
  db?: Database,
  fallback = 4000,
): Promise<number> {
  if (db) {
    const serverId = await getActiveServerId(db);
    if (serverId) {
      const [row] = await db
        .select({ rustMapSize: rustServers.rustMapSize, mapWorldSize: rustServers.mapWorldSize })
        .from(rustServers)
        .where(eq(rustServers.id, serverId))
        .limit(1);
      const stored = row?.rustMapSize ?? row?.mapWorldSize;
      if (stored != null && stored > 0) {
        void rustPlus.getServerInfo().catch(() => {});
        return stored;
      }
    }
  }

  const fromCache = getWorldSize(rustPlus.getCachedServerInfo());
  if (fromCache) {
    void rustPlus.getServerInfo().catch(() => {});
    return fromCache;
  }

  const cachedMap = rustPlus.getCachedMap();
  if (cachedMap?.width != null && cachedMap.width > 0) {
    void rustPlus.getServerInfo().catch(() => {});
    return cachedMap.width;
  }

  try {
    return getWorldSize(await rustPlus.getServerInfo()) ?? fallback;
  } catch {
    return fallback;
  }
}

export async function persistRustMapSize(
  db: Database,
  serverId: string,
  mapSize: number | null | undefined,
): Promise<void> {
  if (mapSize == null || mapSize <= 0) return;
  await db
    .update(rustServers)
    .set({ rustMapSize: mapSize, updatedAt: new Date() })
    .where(eq(rustServers.id, serverId));
}

export function parseTeamRoster(team: unknown, worldSize?: number): ParsedTeamInfo {
  const data = team as {
    leaderSteamId?: string | number | { toString(): string };
    members?: Array<{
      name?: string;
      steamId?: string | number | { toString(): string };
      isOnline?: boolean;
      isAlive?: boolean;
      spawnTime?: number;
      deathTime?: number;
      x?: number;
      y?: number;
    }>;
  };

  const leaderSteamId = formatId(data.leaderSteamId) || null;

  const members = (data.members ?? []).map((m) => {
    const steamId = formatId(m.steamId);
    const isOnline = inferOnline(m, worldSize);
    const x = m.x;
    const y = m.y;
    let locationKnown = x != null && y != null;
    if (
      locationKnown &&
      worldSize != null &&
      isHiddenTeamPosition(x!, y!, worldSize) &&
      !isOnline
    ) {
      locationKnown = false;
    }

    return {
      name: m.name ?? "Unknown",
      steamId,
      isOnline,
      isLeader: Boolean(leaderSteamId && steamId === leaderSteamId),
      isAlive: m.isAlive ?? true,
      locationKnown,
      x,
      y,
      spawnTime: normalizeUnixTime(m.spawnTime),
      deathTime: normalizeUnixTime(m.deathTime),
    };
  });

  return { leaderSteamId, members };
}

function normalizeUnixTime(value: number | undefined): number | null {
  if (value == null || value <= 0) return null;
  return value;
}

function inferOnline(
  member: {
    isOnline?: boolean;
    x?: number;
    y?: number;
  },
  worldSize?: number,
): boolean {
  if (member.isOnline != null) return Boolean(member.isOnline);
  if (member.x == null || member.y == null) return false;
  if (worldSize != null && isHiddenTeamPosition(member.x, member.y, worldSize)) {
    return false;
  }
  return !(member.x === 2500 && member.y === 2500);
}

function formatId(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object" && "toString" in value) {
    return (value as { toString(): string }).toString();
  }
  return String(value);
}

export function parseInGameTime(time: unknown): { isDay?: boolean; time?: string } {
  const data = time as {
    isDay?: boolean;
    time?: number | string;
    sunrise?: number;
    sunset?: number;
  };

  const hour = typeof data.time === "number" ? data.time : undefined;
  let isDay = data.isDay;
  if (isDay == null && hour != null && data.sunrise != null && data.sunset != null) {
    isDay = hour >= data.sunrise && hour < data.sunset;
  }

  let label: string | undefined;
  if (hour != null) {
    const h = Math.floor(hour);
    const m = Math.floor((hour - h) * 60);
    label = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  } else if (typeof data.time === "string") {
    label = data.time;
  }

  return { isDay, time: label };
}
