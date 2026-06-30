export interface TeamChatMessage {
  steamId: string;
  name: string;
  message: string;
  sentAt: number;
}

export function teamChatMessageKey(message: TeamChatMessage): string {
  return `${message.steamId}:${message.sentAt}:${message.message}`;
}

function teamChatRawFields(raw: unknown): {
  steamId?: number | string;
  name?: string;
  message?: string;
  time?: number;
  sentAt?: number;
} {
  const source = raw as Record<string, unknown>;
  const nested = source.message;
  const m = (nested && typeof nested === "object" ? nested : source) as {
    steamId?: number | string;
    userId?: number | string;
    name?: string;
    userName?: string;
    username?: string;
    message?: string;
    time?: number;
    sentAt?: number;
  };
  return {
    steamId: m.steamId ?? m.userId,
    name: m.name ?? m.userName ?? m.username,
    message: m.message,
    time: m.time,
    sentAt: m.sentAt,
  };
}

export function parseTeamChatMessage(raw: unknown): TeamChatMessage | null {
  const m = teamChatRawFields(raw);
  if (!m.message?.trim()) return null;
  return {
    steamId: String(m.steamId ?? ""),
    name: m.name?.trim() || "Unknown",
    message: m.message,
    sentAt: m.sentAt ?? m.time ?? 0,
  };
}

/** Prefer in-message name; fall back to team roster when Rust+ omits it. */
export function resolveTeamChatSenderName(
  message: TeamChatMessage,
  roster?: ReadonlyArray<{ steamId: string; name: string }>,
): string {
  const direct = message.name?.trim();
  if (direct && direct !== "Unknown") return direct;
  const fromRoster = roster?.find((member) => member.steamId === message.steamId)?.name?.trim();
  if (fromRoster) return fromRoster;
  return direct || "Unknown";
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

/** Prefix outbound team chat from Discord/web so in-game can see who sent it. */
export function formatAttributedTeamChatMessage(sender: string, message: string): string {
  const label = sender.trim().slice(0, 32) || "Discord";
  const body = message.trim();
  return `[${label}] ${body}`;
}
