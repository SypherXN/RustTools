/** `!help` in team chat or the Discord commands channel. */
export function parseHelpTeamChatCommand(message: string): boolean {
  const text = message.trim().toLowerCase();
  return text === "!help" || text.startsWith("!help ");
}

/** Multi-message team chat help (Rust chat length limits). */
export function formatTeamChatHelpReplies(): string[] {
  return [
    [
      "RustTools help (1/3)",
      "Team: !online !offline !afk !alive",
      "Events: !cargo !heli !chinook !large !small !vendor !events",
      "World: !deepsea !ds · TC: !upkeepdetail",
    ].join(" · "),
    [
      "RustTools help (2/3)",
      "Switches: !alias · !alias on|off|toggle|status",
      "Timed: !alias on 60s (alias from Devices or Automations)",
    ].join(" · "),
    [
      "RustTools help (3/3)",
      "In-game: !send <discord-user> <msg> · !leader (team leader)",
      "Admin: !mute !unmute",
      "Discord: /help for slash commands",
    ].join(" · "),
  ];
}

export interface DiscordHelpSection {
  name: string;
  value: string;
}

/** Sections for Discord `/help` embed fields. */
export function formatDiscordHelpSections(): DiscordHelpSection[] {
  return [
    {
      name: "Server & devices",
      value: [
        "`/status` — Rust+ connection",
        "`/devices` — paired devices",
        "`/switch <name> [on|off|toggle]` — toggle a switch",
        "`/alarm` — list smart alarms",
        "`/storage <name>` — storage monitor contents",
        "`/pair` — FCM pairing status",
        "`/link` — link Rust+ account",
      ].join("\n"),
    },
    {
      name: "Team & world",
      value: [
        "`/team` — online teammates",
        "`/time` — in-game time",
        "`/deepsea` — Deep Sea status",
        "`/map` — current server map",
        "`/chat <message>` — send in-game team chat",
      ].join("\n"),
    },
    {
      name: "Bang commands (`!` in commands channel)",
      value: [
        "Link a channel with `/channel set` → **In-game command runner**",
        "Then type the same `!` commands as in-game team chat",
        "`!help` — this command list",
        "Team: `!online` `!offline` `!afk` `!alive`",
        "Events: `!cargo` `!heli` `!chinook` `!large` `!small` `!vendor` `!events`",
        "Other: `!deepsea` `!upkeepdetail` · Switches: `!alias on|off|toggle`",
      ].join("\n"),
    },
    {
      name: "Admin",
      value: [
        "`/channel show|set|clear` — notification channel bindings",
        "In-game admin: `!mute` `!unmute` the bot",
      ].join("\n"),
    },
  ];
}
