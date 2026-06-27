import { SlashCommandBuilder } from "discord.js";
import { DISCORD_CHANNEL_PURPOSES, DISCORD_CHANNEL_PURPOSE_LABELS } from "@rusttools/shared";

const channelPurposeChoices = DISCORD_CHANNEL_PURPOSES.map((purpose) => ({
  name: DISCORD_CHANNEL_PURPOSE_LABELS[purpose],
  value: purpose,
}));

const SWITCH_ACTION_CHOICES = [
  { name: "on", value: "on" },
  { name: "off", value: "off" },
  { name: "toggle", value: "toggle" },
  { name: "status", value: "status" },
] as const;

/** In-game `!` commands exposed as Discord slash commands. */
const TEAM_CHAT_SLASH = [
  { name: "online", description: "List teammates who are online" },
  { name: "offline", description: "List teammates who are offline" },
  { name: "afk", description: "List AFK teammates" },
  { name: "alive", description: "List alive teammates" },
  { name: "leader", description: "Promote yourself to team leader (must be online and alive)" },
  { name: "cargo", description: "Cargo ship status and location" },
  { name: "heli", description: "Patrol helicopter status and location" },
  { name: "chinook", description: "Chinook status and location" },
  { name: "vendor", description: "Traveling vendor status and location" },
  { name: "bradley", description: "Bradley APC status and location" },
  { name: "convoy", description: "Convoy status and location" },
  { name: "large", description: "Large oil rig crate unlock status" },
  { name: "small", description: "Small oil rig crate unlock status" },
  { name: "events", description: "Summary of all tracked world events" },
  { name: "upkeep", description: "Tool cupboard upkeep details for linked monitors" },
  { name: "mute", description: "Mute RustTools bot replies in team chat (admin)" },
  { name: "unmute", description: "Unmute RustTools bot replies in team chat (admin)" },
] as const;

export const BANG_SLASH_COMMAND_NAMES = new Set<string>(TEAM_CHAT_SLASH.map((c) => c.name));

export const commands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("List RustTools slash commands"),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check RustTools API and Rust+ connection status"),
  new SlashCommandBuilder()
    .setName("devices")
    .setDescription("List paired switches, alarms, and monitors with live switch ON/OFF"),
  new SlashCommandBuilder()
    .setName("switch")
    .setDescription("Set on, off, toggle, or read status of a smart switch")
    .addStringOption((opt) =>
      opt
        .setName("target")
        .setDescription("Switch name or entity ID")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("action")
        .setDescription("on, off, toggle, or status")
        .addChoices(...SWITCH_ACTION_CHOICES),
    ),
  new SlashCommandBuilder()
    .setName("alias")
    .setDescription("Run a switch chat alias configured on Devices or Automations")
    .addStringOption((opt) =>
      opt.setName("name").setDescription("Chat alias (without !)").setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("action")
        .setDescription("on, off, toggle, or status")
        .addChoices(...SWITCH_ACTION_CHOICES),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("seconds")
        .setDescription("Auto-revert after N seconds (with on or off)")
        .setMinValue(1)
        .setMaxValue(3600),
    ),
  new SlashCommandBuilder()
    .setName("alarm")
    .setDescription("List paired smart alarms"),
  new SlashCommandBuilder()
    .setName("storage")
    .setDescription("Show storage monitor contents and upkeep")
    .addStringOption((opt) =>
      opt
        .setName("target")
        .setDescription("Storage monitor name or entity ID")
        .setRequired(true)
        .setAutocomplete(true),
    ),
  new SlashCommandBuilder()
    .setName("team")
    .setDescription("Team roster with online status and grid positions"),
  new SlashCommandBuilder()
    .setName("time")
    .setDescription("Show in-game time"),
  new SlashCommandBuilder()
    .setName("deepsea")
    .setDescription("Show Deep Sea status and time until open/close"),
  new SlashCommandBuilder()
    .setName("chat")
    .setDescription("Send a team chat message in-game")
    .addStringOption((opt) =>
      opt.setName("message").setDescription("Message to send").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("send")
    .setDescription("Send a Discord DM to a linked teammate")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Discord user to message").setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("message").setDescription("Message text").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("map")
    .setDescription("Post the current server map"),
  new SlashCommandBuilder()
    .setName("pair")
    .setDescription("Show FCM pairing status"),
  new SlashCommandBuilder()
    .setName("link")
    .setDescription("How to link your Steam ID in the web dashboard"),
  ...TEAM_CHAT_SLASH.map(({ name, description }) =>
    new SlashCommandBuilder().setName(name).setDescription(description),
  ),
  new SlashCommandBuilder()
    .setName("channel")
    .setDescription("Link Discord channels to notification purposes")
    .addSubcommand((sub) =>
      sub.setName("show").setDescription("Show current channel bindings for this server"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Link this channel to a notification purpose (admin)")
        .addStringOption((opt) =>
          opt
            .setName("purpose")
            .setDescription("What this channel is used for")
            .setRequired(true)
            .addChoices(...channelPurposeChoices),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("clear")
        .setDescription("Remove a channel binding (admin; falls back to .env)")
        .addStringOption((opt) =>
          opt
            .setName("purpose")
            .setDescription("Which binding to remove")
            .setRequired(true)
            .addChoices(...channelPurposeChoices),
        ),
    ),
  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Block Discord or Steam users from bot commands (admin)")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add a user to the blacklist")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("Discord user to block"),
        )
        .addStringOption((opt) =>
          opt.setName("steam_id").setDescription("Steam ID to block (17 digits)"),
        )
        .addStringOption((opt) =>
          opt.setName("reason").setDescription("Optional reason"),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove a user from the blacklist")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("Discord user to unblock"),
        )
        .addStringOption((opt) =>
          opt.setName("steam_id").setDescription("Steam ID to unblock"),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("List blacklisted users"),
    ),
].map((cmd) => cmd.toJSON());

/** Map slash command name → in-game bang message. */
export const BANG_MESSAGE_BY_SLASH: Record<string, string> = Object.fromEntries(
  TEAM_CHAT_SLASH.map((c) => [c.name, c.name === "upkeep" ? "!upkeepdetail" : `!${c.name}`]),
);
