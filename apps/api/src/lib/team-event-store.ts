import { desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { teamConnectionLog, teamDeathLog } from "@rusttools/db";
import type { NotificationService } from "@rusttools/rustplus-client";
import type { TeamActivitySettings, TeamConnectionEvent, TeamDeathEvent } from "@rusttools/shared";
import { DEFAULT_TEAM_ACTIVITY_SETTINGS, formatTeamConnectionLabel } from "@rusttools/shared";
import { resolveDefaultGuildChannelId } from "./discord-channels.js";
import { getServerNotificationSettings } from "./server-notification-settings.js";
import { generateId } from "./ids.js";

async function resolveTeamActivitySettings(
  db: Database,
  serverId: string,
): Promise<TeamActivitySettings> {
  const settings = await getServerNotificationSettings(db, serverId);
  return settings.teamActivity;
}

async function pruneTeamDeathLog(db: Database, serverId: string, limit: number): Promise<void> {
  if (limit < 1) return;

  const rows = await db
    .select({ id: teamDeathLog.id })
    .from(teamDeathLog)
    .where(eq(teamDeathLog.serverId, serverId))
    .orderBy(desc(teamDeathLog.deathTime))
    .offset(limit);

  if (!rows.length) return;
  await db.delete(teamDeathLog).where(
    inArray(
      teamDeathLog.id,
      rows.map((row) => row.id),
    ),
  );
}

async function pruneTeamConnectionLog(db: Database, serverId: string, limit: number): Promise<void> {
  if (limit < 1) return;

  const rows = await db
    .select({ id: teamConnectionLog.id })
    .from(teamConnectionLog)
    .where(eq(teamConnectionLog.serverId, serverId))
    .orderBy(desc(teamConnectionLog.occurredAt))
    .offset(limit);

  if (!rows.length) return;
  await db.delete(teamConnectionLog).where(
    inArray(
      teamConnectionLog.id,
      rows.map((row) => row.id),
    ),
  );
}

export async function pruneTeamEventLogsToLimits(
  db: Database,
  serverId: string,
  limits: TeamActivitySettings = DEFAULT_TEAM_ACTIVITY_SETTINGS,
): Promise<void> {
  await Promise.all([
    pruneTeamDeathLog(db, serverId, limits.deathLogLimit),
    pruneTeamConnectionLog(db, serverId, limits.connectionLogLimit),
  ]);
}

export async function persistTeamDeaths(
  db: Database,
  serverId: string,
  deaths: TeamDeathEvent[],
): Promise<void> {
  if (deaths.length === 0) return;

  const now = new Date();
  await db.insert(teamDeathLog).values(
    deaths.map((death) => ({
      id: generateId(),
      serverId,
      steamId: death.steamId,
      name: death.name,
      deathTime: death.deathTime,
      x: death.x ?? null,
      y: death.y ?? null,
      grid: death.grid ?? null,
      createdAt: now,
    })),
  );

  const limits = await resolveTeamActivitySettings(db, serverId);
  await pruneTeamDeathLog(db, serverId, limits.deathLogLimit);
}

export async function persistTeamConnections(
  db: Database,
  serverId: string,
  connections: TeamConnectionEvent[],
): Promise<void> {
  if (connections.length === 0) return;

  const now = new Date();
  await db.insert(teamConnectionLog).values(
    connections.map((entry) => ({
      id: generateId(),
      serverId,
      steamId: entry.steamId,
      name: entry.name,
      event: entry.event,
      occurredAt: entry.occurredAt,
      createdAt: now,
    })),
  );

  const limits = await resolveTeamActivitySettings(db, serverId);
  await pruneTeamConnectionLog(db, serverId, limits.connectionLogLimit);
}

export async function listTeamDeathHistory(
  db: Database,
  serverId: string,
  limit = 100,
  offset = 0,
): Promise<TeamDeathEvent[]> {
  const rows = await db
    .select()
    .from(teamDeathLog)
    .where(eq(teamDeathLog.serverId, serverId))
    .orderBy(desc(teamDeathLog.deathTime))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    steamId: row.steamId,
    name: row.name,
    deathTime: row.deathTime,
    ...(row.x != null ? { x: row.x } : {}),
    ...(row.y != null ? { y: row.y } : {}),
    ...(row.grid ? { grid: row.grid } : {}),
  }));
}

export async function listTeamConnectionHistory(
  db: Database,
  serverId: string,
  limit = 50,
  offset = 0,
): Promise<TeamConnectionEvent[]> {
  const rows = await db
    .select()
    .from(teamConnectionLog)
    .where(eq(teamConnectionLog.serverId, serverId))
    .orderBy(desc(teamConnectionLog.occurredAt))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    steamId: row.steamId,
    name: row.name,
    event: row.event as TeamConnectionEvent["event"],
    occurredAt: row.occurredAt,
  }));
}

export async function clearTeamEventLogsForServer(db: Database, serverId: string): Promise<void> {
  await db.delete(teamDeathLog).where(eq(teamDeathLog.serverId, serverId));
  await db.delete(teamConnectionLog).where(eq(teamConnectionLog.serverId, serverId));
}

export async function persistTeamRosterEvents(
  db: Database,
  serverId: string,
  newDeaths: TeamDeathEvent[],
  newConnections: TeamConnectionEvent[],
): Promise<void> {
  await persistTeamDeaths(db, serverId, newDeaths);
  await persistTeamConnections(db, serverId, newConnections);
}

export async function handleTeamRosterEvents(
  db: Database,
  notifications: NotificationService,
  serverId: string,
  newDeaths: TeamDeathEvent[],
  newConnections: TeamConnectionEvent[],
): Promise<void> {
  await persistTeamRosterEvents(db, serverId, newDeaths, newConnections);

  for (const connection of newConnections) {
    notifications.webSocket({ event: "teamConnection", payload: connection });

    const channel = await resolveDefaultGuildChannelId(db, "team_chat");
    if (!channel) continue;

    const color = connection.event === "connected" ? 0x3dd68c : 0xe85d2a;
    await notifications.discord({
      channelId: channel,
      embed: {
        title: formatTeamConnectionLabel(connection),
        description: `${connection.name} ${connection.event === "connected" ? "connected to the server" : "disconnected from the server"}`,
        color,
      },
    });
  }
}
