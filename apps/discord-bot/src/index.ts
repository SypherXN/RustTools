import {
  Client,
  Events,
  GatewayIntentBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { internalFetch, internalPost, mapAttachment } from "./api.js";
import { env } from "./config.js";
import type { DiscordChannelBinding } from "@rusttools/shared";
import { DISCORD_CHANNEL_PURPOSE_LABELS, formatDiscordHelpSections } from "@rusttools/shared";

async function handleHelp(interaction: ChatInputCommandInteraction) {
  const sections = formatDiscordHelpSections();
  await interaction.reply({
    embeds: [
      {
        title: "RustTools commands",
        description:
          "Use slash commands here. In a linked **commands** channel, `!` commands from in-game team chat also work (`!help` there too).",
        fields: sections.map((s) => ({ name: s.name, value: s.value })),
        color: 0x5865f2,
      },
    ],
    ephemeral: true,
  });
}

async function handleStatus(interaction: ChatInputCommandInteraction) {
  const health = await internalFetch<{
    rustplus: { connected: boolean; fcmListening: boolean };
  }>("/internal/health", interaction.user.id);

  await interaction.reply({
    embeds: [
      {
        title: "RustTools Status",
        color: health.rustplus.connected ? 0x3dd68c : 0xe85d2a,
        fields: [
          { name: "Rust+", value: health.rustplus.connected ? "Connected" : "Disconnected", inline: true },
          { name: "FCM", value: health.rustplus.fcmListening ? "Listening" : "Not listening", inline: true },
        ],
      },
    ],
  });
}

async function handleDevices(interaction: ChatInputCommandInteraction) {
  const data = await internalFetch<{
    devices: Array<{ name: string; entityType: string; entityId: number }>;
  }>("/internal/devices", interaction.user.id);

  const lines = data.devices.map((d) => `• **${d.name}** (${d.entityType}) — ID ${d.entityId}`);
  await interaction.reply({
    content: lines.length ? lines.join("\n") : "No devices paired yet.",
    ephemeral: true,
  });
}

async function handleSwitch(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getString("target", true);
  const action = (interaction.options.getString("action") ?? "toggle") as "on" | "off" | "toggle";

  const result = await internalPost<{ ok: boolean; device: string; value: boolean }>(
    "/internal/switch",
    interaction.user.id,
    { target, action },
  );

  await interaction.reply({
    content: `Switch **${result.device}** set to **${result.value ? "ON" : "OFF"}**`,
  });
}

async function handleAlarm(interaction: ChatInputCommandInteraction) {
  const data = await internalFetch<{
    devices: Array<{ name: string; entityId: number; entityType: string }>;
  }>("/internal/devices", interaction.user.id);
  const alarms = data.devices.filter((d) => d.entityType === "smart_alarm");

  await interaction.reply({
    content: alarms.length
      ? alarms.map((a) => `• ${a.name} (ID ${a.entityId})`).join("\n")
      : "No smart alarms paired.",
    ephemeral: true,
  });
}

async function handleStorage(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getString("target", true);
  const data = await internalFetch<{ device: { name: string }; info: unknown }>(
    `/internal/storage/${encodeURIComponent(target)}`,
    interaction.user.id,
  );

  await interaction.reply({
    content: `**${data.device.name}**\n\`\`\`json\n${JSON.stringify(data.info, null, 2).slice(0, 1800)}\n\`\`\``,
    ephemeral: true,
  });
}

async function handleTeam(interaction: ChatInputCommandInteraction) {
  const data = await internalFetch<{ team: unknown }>("/internal/team", interaction.user.id);
  await interaction.reply({
    content: `\`\`\`json\n${JSON.stringify(data.team, null, 2).slice(0, 1900)}\n\`\`\``,
  });
}

async function handleTime(interaction: ChatInputCommandInteraction) {
  const data = await internalFetch<{ time: unknown }>("/internal/time", interaction.user.id);
  await interaction.reply({
    content: `\`\`\`json\n${JSON.stringify(data.time, null, 2)}\n\`\`\``,
    ephemeral: true,
  });
}

async function handleDeepSea(interaction: ChatInputCommandInteraction) {
  const data = await internalFetch<{ status: { label: string; isOpen: boolean; secondsRemaining: number | null } }>(
    "/internal/deepsea",
    interaction.user.id,
  );

  await interaction.reply({
    embeds: [
      {
        title: data.status.isOpen ? "Deep Sea — Open" : "Deep Sea — Closed",
        description: data.status.label,
        color: data.status.isOpen ? 0x3dd68c : 0x5865f2,
      },
    ],
    ephemeral: true,
  });
}

async function handleChat(interaction: ChatInputCommandInteraction) {
  const message = interaction.options.getString("message", true);
  await internalPost("/internal/chat", interaction.user.id, { message });
  await interaction.reply({ content: "Team message sent.", ephemeral: true });
}

async function handleMap(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const data = await internalFetch<{ imageBase64: string | null }>(
    "/internal/map",
    interaction.user.id,
  );
  const attachment = mapAttachment(data.imageBase64);
  if (!attachment) {
    await interaction.editReply({ content: "Map unavailable — is Rust+ connected?" });
    return;
  }
  await interaction.editReply({ files: [attachment] });
}

async function handlePair(interaction: ChatInputCommandInteraction) {
  const health = await internalFetch<{ rustplus: { connected: boolean; fcmListening: boolean } }>(
    "/internal/health",
    interaction.user.id,
  );

  await interaction.reply({
    embeds: [
      {
        title: "Pairing Status",
        fields: [
          { name: "Rust+ Connected", value: health.rustplus.connected ? "Yes" : "No", inline: true },
          { name: "FCM Listening", value: health.rustplus.fcmListening ? "Yes" : "No", inline: true },
        ],
        description: "Pair in-game via Rust+ menu while FCM is active on the server.",
      },
    ],
    ephemeral: true,
  });
}

async function handleLink(interaction: ChatInputCommandInteraction) {
  await interaction.reply({
    content: [
      "**Link your Rust+ account:**",
      `1. Log in at ${env.webUrl}`,
      "2. Go to Settings → click **Link Rust+ Account**",
      "3. Pair your server in-game while FCM is listening",
      "Your Steam ID links automatically on the next pairing notification.",
    ].join("\n"),
    ephemeral: true,
  });
}

function formatChannelBinding(binding: DiscordChannelBinding): string {
  if (!binding.channelId) {
    return `**${binding.label}** — not configured`;
  }
  const mention = `<#${binding.channelId}>`;
  const source =
    binding.source === "database" ? "linked via `/channel`" : binding.source === "env" ? ".env fallback" : "";
  return `**${binding.label}** — ${mention}${source ? ` _(${source})_` : ""}`;
}

async function handleChannel(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a Discord server.",
      ephemeral: true,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === "show") {
    const data = await internalFetch<{ bindings: DiscordChannelBinding[] }>(
      `/internal/channels?guildId=${encodeURIComponent(interaction.guildId)}`,
      interaction.user.id,
    );

    await interaction.reply({
      embeds: [
        {
          title: "Notification channels",
          description: data.bindings.map(formatChannelBinding).join("\n"),
          footer: {
            text: "Use /channel set in a channel to link it. .env values are used when no link is set.",
          },
          color: 0x5865f2,
        },
      ],
      ephemeral: true,
    });
    return;
  }

  if (sub === "set") {
    if (!interaction.channelId || !interaction.channel?.isTextBased()) {
      await interaction.reply({
        content: "Run this command in the text channel you want to link.",
        ephemeral: true,
      });
      return;
    }

    const purpose = interaction.options.getString("purpose", true);
    const result = await internalPost<{ ok: boolean; bindings: DiscordChannelBinding[] }>(
      "/internal/channels/bind",
      interaction.user.id,
      {
        guildId: interaction.guildId,
        purpose,
        channelId: interaction.channelId,
      },
    );

    const label = DISCORD_CHANNEL_PURPOSE_LABELS[purpose as keyof typeof DISCORD_CHANNEL_PURPOSE_LABELS] ?? purpose;

    await interaction.reply({
      content: `Linked <#${interaction.channelId}> for **${label}**.`,
      ephemeral: true,
    });
    void result;
    return;
  }

  if (sub === "clear") {
    const purpose = interaction.options.getString("purpose", true);
    const result = await internalPost<{ ok: boolean; cleared: boolean; bindings: DiscordChannelBinding[] }>(
      "/internal/channels/clear",
      interaction.user.id,
      {
        guildId: interaction.guildId,
        purpose,
      },
    );

    const label = DISCORD_CHANNEL_PURPOSE_LABELS[purpose as keyof typeof DISCORD_CHANNEL_PURPOSE_LABELS] ?? purpose;

    await interaction.reply({
      content: result.cleared
        ? `Cleared **${label}** channel binding. Notifications will use .env fallbacks if configured.`
        : `No **${label}** binding was set via \`/channel\` (may still use .env).`,
      ephemeral: true,
    });
  }
}

async function main() {
  if (!env.botToken) throw new Error("DISCORD_BOT_TOKEN is required");
  if (!env.internalApiKey) throw new Error("INTERNAL_API_KEY is required");

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`Discord bot logged in as ${c.user.tag}`);
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guildId || !message.channel.isTextBased()) return;

    const text = message.content.trim();
    if (!text.startsWith("!")) return;

    try {
      const result = await internalPost<{ replies: string[] }>(
        "/internal/commands-channel/execute",
        message.author.id,
        {
          guildId: message.guildId,
          channelId: message.channelId,
          message: text,
        },
      );

      if (result.replies?.length) {
        await message.reply(result.replies.join("\n"));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Command failed";
      await message.reply(msg).catch(() => {
        /* channel may disallow replies */
      });
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith("storage_recycle:")) {
      const entityDbId = interaction.customId.slice("storage_recycle:".length);
      try {
        const data = await internalFetch<{ embed: { title: string; description: string; color: number; fields: Array<{ name: string; value: string }> } }>(
          `/internal/storage/recycle/${encodeURIComponent(entityDbId)}`,
          interaction.user.id,
        );
        await interaction.reply({
          embeds: [data.embed],
          ephemeral: true,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load recycle breakdown";
        await interaction.reply({ content: msg, ephemeral: true });
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    try {
      switch (interaction.commandName) {
        case "help":
          await handleHelp(interaction);
          break;
        case "status":
          await handleStatus(interaction);
          break;
        case "devices":
          await handleDevices(interaction);
          break;
        case "switch":
          await handleSwitch(interaction);
          break;
        case "alarm":
          await handleAlarm(interaction);
          break;
        case "storage":
          await handleStorage(interaction);
          break;
        case "team":
          await handleTeam(interaction);
          break;
        case "time":
          await handleTime(interaction);
          break;
        case "deepsea":
          await handleDeepSea(interaction);
          break;
        case "chat":
          await handleChat(interaction);
          break;
        case "map":
          await handleMap(interaction);
          break;
        case "pair":
          await handlePair(interaction);
          break;
        case "link":
          await handleLink(interaction);
          break;
        case "channel":
          await handleChannel(interaction);
          break;
        default:
          await interaction.reply({ content: "Unknown command", ephemeral: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Command failed";
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: message, ephemeral: true });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  });

  await client.login(env.botToken);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
