import type { TeamMemberFilter, TeamProximityCheck } from "./automation.js";
import { worldToGridLabel } from "./map-grid.js";
import type { TeamRosterMember } from "./team.js";

/** Chebyshev distance between two grid labels (e.g. F12 → G13 = 1). */
export function gridLabelDistance(a: string, b: string): number {
  const parse = (label: string) => {
    const match = label.match(/^([A-Z]+)(\d+)$/i);
    if (!match) return null;
    const col = match[1]!.toUpperCase();
    const row = Number(match[2]);
    let x = 0;
    for (let i = 0; i < col.length; i++) {
      x = x * 26 + (col.charCodeAt(i) - 64);
    }
    return { x: x - 1, y: row - 1 };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return Infinity;
  return Math.max(Math.abs(pa.x - pb.x), Math.abs(pa.y - pb.y));
}

export function memberMatchesTeamFilter(
  member: TeamRosterMember,
  filter: TeamMemberFilter,
): boolean {
  const status = member.status ?? (member.isOnline ? "online" : "offline");
  switch (filter) {
    case "active":
      return (
        status === "online" &&
        member.locationKnown &&
        member.x != null &&
        member.y != null
      );
    case "online":
      return member.isOnline && status !== "offline" && status !== "dead";
    case "not_offline":
      return status !== "offline";
    default:
      return false;
  }
}

export function isMemberNearPoint(
  member: TeamRosterMember,
  worldX: number,
  worldY: number,
  worldSize: number,
  radiusGrid: number,
): boolean {
  if (member.x == null || member.y == null) return false;
  const memberGrid = worldToGridLabel(member.x, member.y, worldSize);
  const pointGrid = worldToGridLabel(worldX, worldY, worldSize);
  return gridLabelDistance(memberGrid, pointGrid) <= radiusGrid;
}

export function evaluateTeamProximityCheck(
  members: TeamRosterMember[],
  filter: TeamMemberFilter,
  check: TeamProximityCheck,
  worldX: number,
  worldY: number,
  worldSize: number,
  radiusGrid: number,
): boolean {
  const matching = members.filter((m) => memberMatchesTeamFilter(m, filter));
  const near = matching.filter((m) => isMemberNearPoint(m, worldX, worldY, worldSize, radiusGrid));
  const away = matching.length - near.length;

  switch (check) {
    case "any_near":
      return near.length > 0;
    case "all_near":
      return matching.length > 0 && near.length === matching.length;
    case "none_near":
      return near.length === 0;
    case "all_away":
      return matching.length === 0 || away === matching.length;
    case "any_away":
      return away > 0;
    default:
      return false;
  }
}
