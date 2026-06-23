import { SlashCommandBuilder } from "discord.js";

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
].map((cmd) => cmd.toJSON());
