import type { TeamChatMessage } from "@rusttools/shared";
import { appendTeamChatMessage, mergeTeamChatMessages } from "@rusttools/shared";

const buffers = new Map<string, TeamChatMessage[]>();

export function recordTeamChatMessage(serverId: string, message: TeamChatMessage): void {
  const current = buffers.get(serverId) ?? [];
  buffers.set(serverId, appendTeamChatMessage(current, message));
}

export function getBufferedTeamChat(serverId: string): TeamChatMessage[] {
  return buffers.get(serverId) ?? [];
}

export function mergeTeamChatHistory(
  serverId: string,
  fetched: TeamChatMessage[],
): TeamChatMessage[] {
  return mergeTeamChatMessages(fetched, getBufferedTeamChat(serverId));
}
