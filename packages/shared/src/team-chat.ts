export interface TeamChatMessage {
  steamId: string;
  name: string;
  message: string;
  sentAt: number;
}

export function teamChatMessageKey(message: TeamChatMessage): string {
  return `${message.steamId}:${message.sentAt}:${message.message}`;
}

export function parseTeamChatMessage(raw: unknown): TeamChatMessage | null {
  const m = raw as {
    steamId?: number | string;
    name?: string;
    message?: string;
    time?: number;
    sentAt?: number;
  };
  if (!m.message?.trim()) return null;
  return {
    steamId: String(m.steamId ?? ""),
    name: m.name?.trim() || "Unknown",
    message: m.message,
    sentAt: m.sentAt ?? m.time ?? 0,
  };
}

export function parseTeamChatMessages(raw: unknown): TeamChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseTeamChatMessage).filter((m): m is TeamChatMessage => m != null);
}

export function mergeTeamChatMessages(...sources: TeamChatMessage[][]): TeamChatMessage[] {
  const byKey = new Map<string, TeamChatMessage>();
  for (const message of sources.flat()) {
    byKey.set(teamChatMessageKey(message), message);
  }
  return [...byKey.values()].sort((a, b) => a.sentAt - b.sentAt);
}

export function appendTeamChatMessage(
  list: TeamChatMessage[],
  message: TeamChatMessage,
  max = 200,
): TeamChatMessage[] {
  const key = teamChatMessageKey(message);
  if (list.some((entry) => teamChatMessageKey(entry) === key)) {
    return list;
  }
  const next = [...list, message];
  return next.length > max ? next.slice(-max) : next;
}
