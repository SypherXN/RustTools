import {
  DEFAULT_TEAM_ACTIVITY_SETTINGS,
  type ParsedTeamInfo,
  type TeamApiResponse,
  type TeamConnectionEvent,
  type TeamDeathEvent,
  type TeamMemberStatus,
  type TeamRosterMember,
  worldToGridLabel,
} from "@rusttools/shared";
import type { Database } from "@rusttools/db";
import { getServerNotificationSettings } from "./server-notification-settings.js";

/** Seconds without position change before an online alive member is marked AFK. */
export const TEAM_AFK_THRESHOLD_SEC = 300;

interface MemberTrackState {
  lastDeathTime: number | null;
  lastPosition?: { x: number; y: number; changedAt: number };
  /** Previous sampled position for movement heading. */
  prevPosition?: { x: number; y: number };
  heading: number | null;
  wasOnline: boolean;
  /** False until the member has been observed once (avoids false connect on first poll). */
  seen: boolean;
}

interface ServerTeamState {
  members: Map<string, MemberTrackState>;
  deaths: TeamDeathEvent[];
}

const stateByServer = new Map<string, ServerTeamState>();

function getServerState(serverId: string): ServerTeamState {
  let state = stateByServer.get(serverId);
  if (!state) {
    state = { members: new Map(), deaths: [] };
    stateByServer.set(serverId, state);
  }
  return state;
}

function defaultStatus(member: TeamRosterMember): TeamMemberStatus {
  if (!member.isOnline) return "offline";
  if (!member.isAlive) return "dead";
  return "online";
}

function recordDeath(
  state: ServerTeamState,
  member: TeamRosterMember,
  deathTime: number,
  worldSize: number | undefined,
  maxDeaths: number,
): TeamDeathEvent | null {
  const track = state.members.get(member.steamId) ?? {
    lastDeathTime: null,
    wasOnline: false,
    seen: false,
    heading: null,
  };

  const prev = track.lastDeathTime;
  track.lastDeathTime = deathTime;
  state.members.set(member.steamId, track);

  if (prev != null && prev > 0 && deathTime !== prev) {
    const event: TeamDeathEvent = {
      steamId: member.steamId,
      name: member.name,
      deathTime,
    };
    if (member.locationKnown && member.x != null && member.y != null) {
      event.x = member.x;
      event.y = member.y;
      if (worldSize != null) {
        event.grid = worldToGridLabel(member.x, member.y, worldSize);
      }
    }
    state.deaths.unshift(event);
    if (state.deaths.length > maxDeaths) {
      state.deaths.length = maxDeaths;
    }
    return event;
  }

  if (prev == null) {
    state.members.set(member.steamId, track);
  }

  return null;
}

function inferStatus(
  member: TeamRosterMember,
  track: MemberTrackState,
  nowSec: number,
): { status: TeamMemberStatus; afkSince: number | null; heading: number | null } {
  if (!member.isOnline) {
    track.wasOnline = false;
    return { status: "offline", afkSince: null, heading: track.heading };
  }

  if (!member.isAlive) {
    track.wasOnline = true;
    return { status: "dead", afkSince: null, heading: track.heading };
  }

  const hasPosition =
    member.locationKnown !== false && member.x != null && member.y != null;

  if (!hasPosition) {
    track.wasOnline = true;
    return { status: "online", afkSince: null, heading: track.heading };
  }

  const x = member.x!;
  const y = member.y!;

  if (!track.wasOnline || !track.lastPosition) {
    track.wasOnline = true;
    track.lastPosition = { x, y, changedAt: nowSec };
    return { status: "online", afkSince: null, heading: track.heading };
  }

  if (track.lastPosition.x !== x || track.lastPosition.y !== y) {
    if (track.prevPosition) {
      const dx = x - track.prevPosition.x;
      const dy = y - track.prevPosition.y;
      if (Math.hypot(dx, dy) > 0.5) {
        track.heading = (Math.atan2(dy, dx) * 180) / Math.PI;
      }
    }
    track.prevPosition = { x: track.lastPosition.x, y: track.lastPosition.y };
    track.lastPosition = { x, y, changedAt: nowSec };
    return { status: "online", afkSince: null, heading: track.heading };
  }

  const idleSec = nowSec - track.lastPosition.changedAt;
  if (idleSec >= TEAM_AFK_THRESHOLD_SEC) {
    return { status: "afk", afkSince: track.lastPosition.changedAt, heading: track.heading };
  }

  return { status: "online", afkSince: null, heading: track.heading };
}

function inferOnlineTransition(
  member: TeamRosterMember,
  track: MemberTrackState,
): TeamConnectionEvent | null {
  if (!track.seen) {
    track.seen = true;
    track.wasOnline = member.isOnline;
    return null;
  }

  const isOnline = member.isOnline;
  const wasOnline = track.wasOnline;

  if (isOnline && !wasOnline) {
    return {
      steamId: member.steamId,
      name: member.name,
      event: "connected",
      occurredAt: Math.floor(Date.now() / 1000),
    };
  }

  if (!isOnline && wasOnline) {
    return {
      steamId: member.steamId,
      name: member.name,
      event: "disconnected",
      occurredAt: Math.floor(Date.now() / 1000),
    };
  }

  return null;
}

export function clearTeamTrackerState(serverId: string): void {
  stateByServer.delete(serverId);
}

export function trimTeamTrackerDeaths(serverId: string, maxDeaths: number): void {
  const state = stateByServer.get(serverId);
  if (state && state.deaths.length > maxDeaths) {
    state.deaths.length = maxDeaths;
  }
}

export function processTeamRoster(
  serverId: string,
  team: ParsedTeamInfo,
  worldSize?: number,
  nowSec = Math.floor(Date.now() / 1000),
  maxDeaths = DEFAULT_TEAM_ACTIVITY_SETTINGS.deathLogLimit,
): {
  team: ParsedTeamInfo;
  deaths: TeamDeathEvent[];
  newDeaths: TeamDeathEvent[];
  newConnections: TeamConnectionEvent[];
} {
  const state = getServerState(serverId);
  const newDeaths: TeamDeathEvent[] = [];
  const newConnections: TeamConnectionEvent[] = [];

  const members = team.members.map((member) => {
    let track = state.members.get(member.steamId);
    if (!track) {
      track = { lastDeathTime: null, wasOnline: false, seen: false, heading: null };
      state.members.set(member.steamId, track);
    }

    const connection = inferOnlineTransition(member, track);
    if (connection) {
      newConnections.push(connection);
    }

    if (member.deathTime && member.deathTime > 0) {
      const death = recordDeath(state, member, member.deathTime, worldSize, maxDeaths);
      if (death) newDeaths.push(death);
    }

    const { status, afkSince, heading } = inferStatus(member, track, nowSec);
    state.members.set(member.steamId, track);

    return {
      ...member,
      status,
      afkSince,
      heading,
    };
  });

  return {
    team: { ...team, members },
    deaths: [...state.deaths],
    newDeaths,
    newConnections,
  };
}

export function applyTeamTracking(
  serverId: string | null,
  team: ParsedTeamInfo,
  worldSize?: number,
  maxDeaths = DEFAULT_TEAM_ACTIVITY_SETTINGS.deathLogLimit,
): {
  team: ParsedTeamInfo;
  deaths: TeamDeathEvent[];
  newDeaths: TeamDeathEvent[];
  newConnections: TeamConnectionEvent[];
} {
  if (!serverId) {
    return {
      team: {
        ...team,
        members: team.members.map((member) => ({
          ...member,
          status: defaultStatus(member),
          afkSince: null,
          heading: null,
        })),
      },
      deaths: [],
      newDeaths: [],
      newConnections: [],
    };
  }

  const result = processTeamRoster(serverId, team, worldSize, undefined, maxDeaths);
  return {
    team: result.team,
    deaths: result.deaths,
    newDeaths: result.newDeaths,
    newConnections: result.newConnections,
  };
}

export async function applyTeamTrackingWithSettings(
  db: Database,
  serverId: string | null,
  team: ParsedTeamInfo,
  worldSize?: number,
) {
  const maxDeaths = serverId
    ? (await getServerNotificationSettings(db, serverId)).teamActivity.deathLogLimit
    : DEFAULT_TEAM_ACTIVITY_SETTINGS.deathLogLimit;
  return applyTeamTracking(serverId, team, worldSize, maxDeaths);
}

export async function processTeamRosterWithSettings(
  db: Database,
  serverId: string,
  team: ParsedTeamInfo,
  worldSize?: number,
) {
  const maxDeaths = (await getServerNotificationSettings(db, serverId)).teamActivity.deathLogLimit;
  return processTeamRoster(serverId, team, worldSize, undefined, maxDeaths);
}

export function enrichTeamApiResponse(
  pairedPlayerId: string | null,
  team: ParsedTeamInfo,
  deaths: TeamDeathEvent[],
  canPromote = false,
): TeamApiResponse {
  return { team, deaths, pairedPlayerId, canPromote };
}
