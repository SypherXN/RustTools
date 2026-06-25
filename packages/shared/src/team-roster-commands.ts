import type { ParsedTeamInfo, TeamMemberStatus, TeamRosterMember } from "./team.js";
import { sortTeamRoster, teamMemberStatus } from "./team.js";

export type RosterChatCommand = "online" | "offline" | "afk" | "alive";

const ROSTER_COMMANDS: Record<string, RosterChatCommand> = {
  "!online": "online",
  "!offline": "offline",
  "!afk": "afk",
  "!alive": "alive",
};

export function parseRosterTeamChatCommand(message: string): RosterChatCommand | null {
  const text = message.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return ROSTER_COMMANDS[text] ?? null;
}

export function parseLeaderTeamChatCommand(message: string): boolean {
  const text = message.trim().toLowerCase();
  return text === "!leader" || text.startsWith("!leader ");
}

function matchesFilter(status: TeamMemberStatus, filter: RosterChatCommand): boolean {
  switch (filter) {
    case "online":
      return status === "online" || status === "afk";
    case "offline":
      return status === "offline";
    case "afk":
      return status === "afk";
    case "alive":
      return status === "online" || status === "afk";
    default:
      return false;
  }
}

function formatMemberLine(member: TeamRosterMember): string {
  const status = teamMemberStatus(member);
  const tag = member.isLeader ? " (leader)" : "";
  if (status === "afk") return `${member.name}${tag} — AFK`;
  if (status === "dead") return `${member.name}${tag} — dead`;
  return `${member.name}${tag}`;
}

export function formatRosterCommandResponse(
  filter: RosterChatCommand,
  team: ParsedTeamInfo,
): string {
  const members = sortTeamRoster(team.members).filter((m) =>
    matchesFilter(teamMemberStatus(m), filter),
  );

  const labels: Record<RosterChatCommand, string> = {
    online: "Online",
    offline: "Offline",
    afk: "AFK",
    alive: "Alive",
  };

  if (members.length === 0) {
    return `RustTools: No teammates ${labels[filter].toLowerCase()}.`;
  }

  const lines = members.map(formatMemberLine);
  return `RustTools ${labels[filter]} (${members.length}): ${lines.join(", ")}`;
}
