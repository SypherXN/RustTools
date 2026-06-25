export type TeamMemberStatus = "online" | "afk" | "offline" | "dead";

export interface TeamRosterMember {
  name: string;
  steamId: string;
  isOnline: boolean;
  isLeader: boolean;
  isAlive: boolean;
  locationKnown: boolean;
  x?: number;
  y?: number;
  /** Unix seconds — when the player spawned this life. */
  spawnTime: number | null;
  /** Unix seconds — when the player last died (0 if never / unknown). */
  deathTime: number | null;
  /** Derived presence state (online, afk, offline, dead). */
  status?: TeamMemberStatus;
  /** Unix seconds — when position last changed (AFK inference). */
  afkSince?: number | null;
}

export interface TeamDeathEvent {
  steamId: string;
  name: string;
  deathTime: number;
  x?: number;
  y?: number;
  grid?: string;
}

export interface TeamConnectionEvent {
  steamId: string;
  name: string;
  event: "connected" | "disconnected";
  occurredAt: number;
}

export interface ParsedTeamInfo {
  leaderSteamId: string | null;
  members: TeamRosterMember[];
}

export interface TeamApiResponse {
  team: ParsedTeamInfo;
  deaths: TeamDeathEvent[];
  /** Steam ID of the account paired to RustTools for this server. */
  pairedPlayerId: string | null;
  /** True when the paired account is the in-game team leader (can promote via Rust+). */
  canPromote: boolean;
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

export function teamMemberStatus(
  member: Pick<TeamRosterMember, "isOnline" | "isAlive" | "status">,
): TeamMemberStatus {
  if (member.status) return member.status;
  if (!member.isOnline) return "offline";
  if (!member.isAlive) return "dead";
  return "online";
}

export function formatTeamAfkDuration(
  afkSince: number | null | undefined,
  nowSec = Math.floor(Date.now() / 1000),
): string | null {
  if (!afkSince || afkSince <= 0) return null;
  const elapsed = nowSec - afkSince;
  if (elapsed < 0) return null;
  return `~${formatDuration(elapsed)}`;
}

export function formatTeamDeathAgo(deathTime: number | null, nowSec = Math.floor(Date.now() / 1000)): string | null {
  if (!deathTime || deathTime <= 0) return null;
  const ago = nowSec - deathTime;
  if (ago < 0) return null;
  return `${formatDuration(ago)} ago`;
}

export function formatTeamSession(
  spawnTime: number | null,
  isOnline: boolean,
  nowSec = Math.floor(Date.now() / 1000),
): string | null {
  if (!isOnline || !spawnTime || spawnTime <= 0) return null;
  const elapsed = nowSec - spawnTime;
  if (elapsed < 0) return null;
  return `~${formatDuration(elapsed)}`;
}

export function formatTeamConnectionLabel(connection: TeamConnectionEvent): string {
  const verb = connection.event === "connected" ? "joined" : "left";
  return `${connection.name} ${verb}`;
}

export function formatTeamConnectionAgo(
  occurredAt: number,
  nowSec = Math.floor(Date.now() / 1000),
): string | null {
  const ago = nowSec - occurredAt;
  if (ago < 0) return null;
  return `${formatDuration(ago)} ago`;
}

export function sortTeamRoster(members: TeamRosterMember[]): TeamRosterMember[] {
  return [...members].sort((a, b) => {
    if (a.isLeader !== b.isLeader) return a.isLeader ? -1 : 1;
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
