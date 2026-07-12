import type { TeamRosterMember } from "@rusttools/shared";
import { formatWorldCoords } from "@rusttools/shared";

export function formatTeamGridLocation(
  member: Pick<TeamRosterMember, "locationKnown" | "x" | "y">,
  worldSize: number,
): string | null {
  if (member.locationKnown === false || member.x == null || member.y == null) {
    return null;
  }
  return formatWorldCoords(member.x, member.y, worldSize);
}
