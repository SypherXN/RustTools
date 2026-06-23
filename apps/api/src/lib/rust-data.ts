import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustServers } from "@rusttools/db";

export async function getActiveServerId(db: Database): Promise<string | null> {
  const [server] = await db
    .select({ id: rustServers.id })
    .from(rustServers)
    .where(eq(rustServers.isActive, true))
    .limit(1);
  return server?.id ?? null;
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

export function parseTeamRoster(team: unknown): Array<{
  name: string;
  steamId: string;
  isOnline: boolean;
  x?: number;
  y?: number;
}> {
  const data = team as {
    members?: Array<{
      name?: string;
      steamId?: string | number;
      isOnline?: boolean;
      x?: number;
      y?: number;
    }>;
  };
  return (data.members ?? []).map((m) => ({
    name: m.name ?? "Unknown",
    steamId: String(m.steamId ?? ""),
    isOnline: Boolean(m.isOnline),
    x: m.x,
    y: m.y,
  }));
}

export function parseInGameTime(time: unknown): { isDay?: boolean; time?: string } {
  const data = time as { isDay?: boolean; time?: string; dayLengthMinutes?: number };
  return { isDay: data.isDay, time: data.time };
}
