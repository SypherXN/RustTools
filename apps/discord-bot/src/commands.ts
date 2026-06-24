import { SlashCommandBuilder } from "discord.js";
import { DISCORD_CHANNEL_PURPOSES, DISCORD_CHANNEL_PURPOSE_LABELS } from "@rusttools/shared";

const channelPurposeChoices = DISCORD_CHANNEL_PURPOSES.map((purpose) => ({
  name: DISCORD_CHANNEL_PURPOSE_LABELS[purpose],
  value: purpose,
}));

export const commands = [
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check RustTools API and Rust+ connection status"),
  new SlashCommandBuilder()
    .setName("devices")
    .setDescription("List all paired smart devices"),
  new SlashCommandBuilder()
    .setName("switch")
    .setDescription("Toggle a smart switch by name or entity ID")
    .addStringOption((opt) =>
      opt.setName("target").setDescription("Switch name or entity ID").setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("action")
        .setDescription("on, off, or toggle")
        .addChoices(
          { name: "on", value: "on" },
          { name: "off", value: "off" },
          { name: "toggle", value: "toggle" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("alarm")
    .setDescription("List paired smart alarms"),
  new SlashCommandBuilder()
    .setName("storage")
    .setDescription("Show storage monitor contents")
    .addStringOption((opt) =>
      opt.setName("target").setDescription("Storage monitor name or entity ID").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("team")
    .setDescription("Show online teammates"),
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
    .setName("map")
    .setDescription("Post the current server map"),
  new SlashCommandBuilder()
    .setName("pair")
    .setDescription("Show FCM pairing status"),
  new SlashCommandBuilder()
    .setName("link")
    .setDescription("Start Rust+ account linking"),
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
].map((cmd) => cmd.toJSON());
