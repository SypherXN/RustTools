export interface WebHelpCategory {
  name: string;
  commands: string[];
}

/** In-game team chat commands grouped for the web dashboard. */
export function formatWebHelpCategories(): WebHelpCategory[] {
  return [
    {
      name: "Team",
      commands: ["!online", "!offline", "!afk", "!alive", "!leader"],
    },
    {
      name: "World events",
      commands: ["!cargo", "!heli", "!chinook", "!vendor", "!bradley", "!convoy", "!large", "!small", "!events"],
    },
    {
      name: "World & TC",
      commands: ["!deepsea", "!ds", "!upkeepdetail"],
    },
    {
      name: "Switches",
      commands: ["!<alias>", "!<alias> on|off|toggle|status", "!<alias> on 60s"],
    },
    {
      name: "Messaging",
      commands: ["!send <discord-user> <msg>"],
    },
    {
      name: "Admin",
      commands: ["!mute", "!unmute"],
    },
    {
      name: "Help",
      commands: ["!help"],
    },
  ];
}

/** `!help` in team chat. */
export function parseHelpTeamChatCommand(message: string): boolean {
  const text = message.trim().toLowerCase();
  return text === "!help" || text.startsWith("!help ");
}

/** Multi-message team chat help (Rust chat length limits). */
export function formatTeamChatHelpReplies(fromDiscord = false): string[] {
  const discordNote = fromDiscord
    ? "Discord: use `/help` for slash commands (same features as `!` in-game)"
    : "Discord: same commands as `/online`, `/cargo`, `/alias`, etc.";

  return [
    [
      "RustTools help (1/3)",
      "Team: !online !offline !afk !alive !leader",
      "Events: !cargo !heli !chinook !bradley !convoy !large !small !vendor !events",
      "World: !deepsea !ds · TC: !upkeepdetail",
    ].join(" · "),
    [
      "RustTools help (2/3)",
      "Switches: !alias · !alias on|off|toggle|status",
      "Timed: !alias on 60s (alias from Devices or Automations)",
    ].join(" · "),
    [
      "RustTools help (3/3)",
      "!send <discord-user> <msg> · Admin: !mute !unmute",
      discordNote,
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
        "`/switch` — set on, off, toggle, or status by name/ID",
        "`/alias` — switch chat alias (`action:status` for ON/OFF)",
        "`/alarm` — smart alarms",
        "`/storage` — storage monitor contents",
        "`/pair` · `/link` — pairing & account link",
      ].join("\n"),
    },
    {
      name: "Team & world",
      value: [
        "`/online` `/offline` `/afk` `/alive` — roster filters",
        "`/leader` — promote yourself to team leader (must be online and alive)",
        "`/time` — in-game time",
        "`/deepsea` — Deep Sea status",
        "`/upkeep` — TC upkeep report",
        "`/map` — server map image",
        "`/chat` — send in-game team chat",
        "`/send` — DM a linked Discord teammate",
      ].join("\n"),
    },
    {
      name: "World events",
      value: [
        "`/cargo` `/heli` `/chinook` `/vendor`",
        "`/bradley` `/convoy` `/large` `/small`",
        "`/events` — all tracked events",
      ].join("\n"),
    },
    {
      name: "Admin",
      value: [
        "`/channel show|set|clear` — notification channels",
        "`/blacklist add|remove|list` — block users",
        "`/mute` `/unmute` — bot team-chat replies",
      ].join("\n"),
    },
  ];
}
