import {
  type ParsedTeamInfo,
  type TeamApiResponse,
  type TeamDeathEvent,
  type TeamMemberStatus,
  type TeamRosterMember,
  worldToGridLabel,
} from "@rusttools/shared";

/** Seconds without position change before an online alive member is marked AFK. */
export const TEAM_AFK_THRESHOLD_SEC = 300;

const MAX_DEATHS_PER_SERVER = 100;

interface MemberTrackState {
  lastDeathTime: number | null;
  lastPosition?: { x: number; y: number; changedAt: number };
  wasOnline: boolean;
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
  worldSize?: number,
): TeamDeathEvent | null {
  const track = state.members.get(member.steamId) ?? {
    lastDeathTime: null,
    wasOnline: false,
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
    if (state.deaths.length > MAX_DEATHS_PER_SERVER) {
      state.deaths.length = MAX_DEATHS_PER_SERVER;
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
): { status: TeamMemberStatus; afkSince: number | null } {
  if (!member.isOnline) {
    track.wasOnline = false;
    return { status: "offline", afkSince: null };
  }

  if (!member.isAlive) {
    track.wasOnline = true;
    return { status: "dead", afkSince: null };
  }

  const hasPosition =
    member.locationKnown !== false && member.x != null && member.y != null;

  if (!hasPosition) {
    track.wasOnline = true;
    return { status: "online", afkSince: null };
  }

  const x = member.x!;
  const y = member.y!;

  if (!track.wasOnline || !track.lastPosition) {
    track.wasOnline = true;
    track.lastPosition = { x, y, changedAt: nowSec };
    return { status: "online", afkSince: null };
  }

  if (track.lastPosition.x !== x || track.lastPosition.y !== y) {
    track.lastPosition = { x, y, changedAt: nowSec };
    return { status: "online", afkSince: null };
  }

  const idleSec = nowSec - track.lastPosition.changedAt;
  if (idleSec >= TEAM_AFK_THRESHOLD_SEC) {
    return { status: "afk", afkSince: track.lastPosition.changedAt };
  }

  return { status: "online", afkSince: null };
}

export function processTeamRoster(
  serverId: string,
  team: ParsedTeamInfo,
  worldSize?: number,
  nowSec = Math.floor(Date.now() / 1000),
): { team: ParsedTeamInfo; deaths: TeamDeathEvent[]; newDeaths: TeamDeathEvent[] } {
  const state = getServerState(serverId);
  const newDeaths: TeamDeathEvent[] = [];

  const members = team.members.map((member) => {
    let track = state.members.get(member.steamId);
    if (!track) {
      track = { lastDeathTime: null, wasOnline: false };
      state.members.set(member.steamId, track);
    }

    if (member.deathTime && member.deathTime > 0) {
      const death = recordDeath(state, member, member.deathTime, worldSize);
      if (death) newDeaths.push(death);
    }

    const { status, afkSince } = inferStatus(member, track, nowSec);
    state.members.set(member.steamId, track);

    return {
      ...member,
      status,
      afkSince,
    };
  });

  return {
    team: { ...team, members },
    deaths: [...state.deaths],
    newDeaths,
  };
}

export function applyTeamTracking(
  serverId: string | null,
  team: ParsedTeamInfo,
  worldSize?: number,
): { team: ParsedTeamInfo; deaths: TeamDeathEvent[] } {
  if (!serverId) {
    return {
      team: {
        ...team,
        members: team.members.map((member) => ({
          ...member,
          status: defaultStatus(member),
          afkSince: null,
        })),
      },
      deaths: [],
    };
  }

  const result = processTeamRoster(serverId, team, worldSize);
  return { team: result.team, deaths: result.deaths };
}

export function enrichTeamApiResponse(
  pairedPlayerId: string | null,
  team: ParsedTeamInfo,
  deaths: TeamDeathEvent[],
): TeamApiResponse {
  const canPromote = Boolean(
    pairedPlayerId && team.leaderSteamId && pairedPlayerId === team.leaderSteamId,
  );
  return { team, deaths, pairedPlayerId, canPromote };
}
