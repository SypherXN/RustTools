import type { TeamRosterMember } from "@rusttools/shared";
import { worldToGridLabel } from "@rusttools/shared";

export type TeamMemberLocation = Pick<
  TeamRosterMember,
  "isOnline" | "isAlive" | "locationKnown" | "x" | "y"
>;

export function formatTeamGridLocation(
  member: Pick<TeamRosterMember, "locationKnown" | "x" | "y">,
  worldSize: number,
): string | null {
  if (member.locationKnown === false || member.x == null || member.y == null) {
    return null;
  }
  const grid = worldToGridLabel(member.x, member.y, worldSize);
  return `${grid} (${Math.round(member.x)}, ${Math.round(member.y)})`;
}

/** @deprecated Use formatTeamGridLocation — kept for map overlay labels */
export function formatTeamMemberLocation(member: TeamMemberLocation): string {
  if (member.locationKnown === false || member.x == null || member.y == null) {
    return " — location unknown";
  }
  if (member.isOnline) {
    return ` @ ${Math.round(member.x)}, ${Math.round(member.y)}`;
  }
  return ` — offline @ ${Math.round(member.x)}, ${Math.round(member.y)}`;
}
