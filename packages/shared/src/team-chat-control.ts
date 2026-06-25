export interface TeamChatBotSettings {
  /** When true, the bot does not send messages to in-game team chat. */
  muted: boolean;
  /** Minimum milliseconds between handled `!` commands (0 = no delay). */
  commandDelayMs: number;
}

export const DEFAULT_TEAM_CHAT_BOT_SETTINGS: TeamChatBotSettings = {
  muted: false,
  commandDelayMs: 0,
};

export function parseMuteTeamChatCommand(message: string): boolean {
  const text = message.trim().toLowerCase();
  return text === "!mute" || text.startsWith("!mute ");
}

export function parseUnmuteTeamChatCommand(message: string): boolean {
  const text = message.trim().toLowerCase();
  return text === "!unmute" || text.startsWith("!unmute ");
}

export function parseSendTeamChatCommand(message: string): { target: string; text: string } | null {
  const trimmed = message.trim();
  if (!/^!send\b/i.test(trimmed)) return null;

  const rest = trimmed.replace(/^!send\s+/i, "").trim();
  const space = rest.indexOf(" ");
  if (space <= 0) return null;

  const target = rest.slice(0, space).trim();
  const text = rest.slice(space + 1).trim();
  if (!target || !text) return null;

  return { target, text };
}

/** True when the message looks like a bot team-chat command. */
export function isTeamChatBotCommand(message: string): boolean {
  const text = message.trim();
  if (!text.startsWith("!")) return false;
  return (
    parseMuteTeamChatCommand(text) ||
    parseUnmuteTeamChatCommand(text) ||
    parseSendTeamChatCommand(text) !== null ||
    /^!deepsea\b/i.test(text) ||
    /^!ds\b/i.test(text) ||
    /^!leader\b/i.test(text) ||
    /^!online\b/i.test(text) ||
    /^!offline\b/i.test(text) ||
    /^!afk\b/i.test(text) ||
    /^!alive\b/i.test(text)
  );
}
