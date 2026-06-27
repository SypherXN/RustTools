import {
  Client,
  Events,
  GatewayIntentBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { internalFetch, internalPost, mapAttachment, ApiError } from "./api.js";
import { env } from "./config.js";
import { BANG_MESSAGE_BY_SLASH, BANG_SLASH_COMMAND_NAMES } from "./commands.js";
import type { DiscordChannelBinding } from "@rusttools/shared";
import { DISCORD_CHANNEL_PURPOSE_LABELS, formatDeepSeaDiscordDescription, formatDiscordHelpSections } from "@rusttools/shared";
import { buildAliasBangMessage, runBangCommand } from "./team-command.js";
import { errorEmbed, permissionDeniedEmbed, replyEmbed, toApiEmbed } from "./reply-embeds.js";
import {
  alarmsEmbed,
  blacklistEmbed,
  channelSetEmbed,
  chatSentEmbed,
  devicesEmbed,
  linkAccountEmbed,
  storageEmbed,
  switchResultEmbed,
  teamRosterEmbed,
  timeEmbed,
} from "./ui-embeds.js";

async function handleHelp(interaction: ChatInputCommandInteraction) {
  const sections = formatDiscordHelpSections();
  await interaction.reply({
    embeds: [
      {
        title: "RustTools commands",
        description:
          "Use slash commands below — they mirror in-game team chat `!` commands (Switch permission required).",
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
    devices: Array<{
      name: string;
      displayName?: string | null;
      entityType: string;
      entityId: number;
      switchValue?: boolean | null;
    }>;
  }>("/internal/devices", interaction.user.id);

  await replyEmbed(interaction, devicesEmbed(data.devices), { ephemeral: true });
}

async function handleSwitch(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getString("target", true);
  const action = (interaction.options.getString("action") ?? "toggle") as
    | "on"
    | "off"
    | "toggle"
    | "status";

  const result = await internalPost<{
    ok: boolean;
    device: string;
    value: boolean | null;
    readOnly?: boolean;
  }>("/internal/switch", interaction.user.id, { target, action });

  await replyEmbed(
    interaction,
    switchResultEmbed(result.device, result.value, { readOnly: result.readOnly ?? action === "status" }),
  );
}

async function handleDeviceAutocomplete(
  interaction: import("discord.js").AutocompleteInteraction,
  entityType: "smart_switch" | "storage_monitor",
): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();

  try {
    const data = await internalFetch<{
      targets: Array<{ name: string; entityId: number; label: string }>;
    }>(
      `/internal/device-targets?entityType=${encodeURIComponent(entityType)}`,
      interaction.user.id,
    );

    const matches = data.targets
      .filter(
        (t) =>
          !focused ||
          t.name.toLowerCase().includes(focused) ||
          String(t.entityId).includes(focused),
      )
      .slice(0, 25)
      .map((t) => ({ name: t.label.slice(0, 100), value: t.name.slice(0, 100) }));

    await interaction.respond(matches);
  } catch {
    await interaction.respond([]);
  }
}

async function handleAlarm(interaction: ChatInputCommandInteraction) {
  const data = await internalFetch<{
    devices: Array<{ name: string; entityId: number; entityType: string }>;
  }>("/internal/devices", interaction.user.id);
  const alarms = data.devices.filter((d) => d.entityType === "smart_alarm");

  await replyEmbed(interaction, alarmsEmbed(alarms), { ephemeral: true });
}

async function handleStorage(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getString("target", true);
  const data = await internalFetch<{ device: { name: string }; info: unknown }>(
    `/internal/storage/${encodeURIComponent(target)}`,
    interaction.user.id,
  );

  await replyEmbed(interaction, storageEmbed(data.device.name, data.info), { ephemeral: true });
}

async function handleTeam(interaction: ChatInputCommandInteraction) {
  const data = await internalFetch<{ team: import("@rusttools/shared").ParsedTeamInfo; worldSize?: number }>(
    "/internal/team",
    interaction.user.id,
  );
  await replyEmbed(interaction, teamRosterEmbed(data.team, data.worldSize));
}

async function handleTime(interaction: ChatInputCommandInteraction) {
  const data = await internalFetch<{ time: unknown }>("/internal/time", interaction.user.id);
  await replyEmbed(interaction, timeEmbed(data.time), { ephemeral: true });
}

async function handleDeepSea(interaction: ChatInputCommandInteraction) {
  const data = await internalFetch<{ status: import("@rusttools/shared").DeepSeaStatus }>(
    "/internal/deepsea",
    interaction.user.id,
  );

  await replyEmbed(interaction, {
    title: data.status.isOpen ? "Deep Sea — Open" : "Deep Sea — Closed",
    description: formatDeepSeaDiscordDescription(data.status),
    color: data.status.isOpen ? 0x3dd68c : 0x5865f2,
    footer: { text: "RustTools" },
    timestamp: new Date().toISOString(),
  }, { ephemeral: true });
}

async function handleChat(interaction: ChatInputCommandInteraction) {
  const message = interaction.options.getString("message", true);
  const discordUsername = interaction.user.globalName ?? interaction.user.username;
  await internalPost("/internal/chat", interaction.user.id, { message, discordUsername });
  await replyEmbed(interaction, chatSentEmbed(), { ephemeral: true });
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
  await replyEmbed(interaction, linkAccountEmbed(env.webUrl), { ephemeral: true });
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

    await replyEmbed(
      interaction,
      channelSetEmbed(label, interaction.channelId, purpose === "information"),
      { ephemeral: true },
    );
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

    await replyEmbed(
      interaction,
      {
        title: result.cleared ? "Channel unlinked" : "No binding found",
        description: result.cleared
          ? `Cleared **${label}** channel binding. Notifications will use .env fallbacks if configured.`
          : `No **${label}** binding was set via \`/channel\` (may still use .env).`,
        color: result.cleared ? 0x3dd68c : 0x5865f2,
        footer: { text: "RustTools" },
      },
      { ephemeral: true },
    );
  }
}

async function handleBlacklist(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a Discord server.",
      ephemeral: true,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === "list") {
    const data = await internalFetch<{ entries: Array<{ discordId: string | null; steamId: string | null; reason: string }> }>(
      `/internal/blacklist?guildId=${encodeURIComponent(interaction.guildId)}`,
      interaction.user.id,
    );

    await replyEmbed(interaction, blacklistEmbed(data.entries), { ephemeral: true });
    return;
  }

  if (sub === "add") {
    const user = interaction.options.getUser("user");
    const steamId = interaction.options.getString("steam_id");
    const reason = interaction.options.getString("reason") ?? undefined;

    if (!user && !steamId) {
      await interaction.reply({
        content: "Provide a Discord user and/or Steam ID to blacklist.",
        ephemeral: true,
      });
      return;
    }

    await internalPost("/internal/blacklist/add", interaction.user.id, {
      guildId: interaction.guildId,
      targetDiscordId: user?.id,
      steamId: steamId ?? undefined,
      reason,
    });

    const label = user ? user.tag : `Steam ${steamId}`;
    await replyEmbed(
      interaction,
      {
        title: "User blacklisted",
        description: `**${label}** has been added to the blacklist.`,
        color: 0xe85d2a,
        footer: { text: "RustTools" },
      },
      { ephemeral: true },
    );
    return;
  }

  if (sub === "remove") {
    const user = interaction.options.getUser("user");
    const steamId = interaction.options.getString("steam_id");

    if (!user && !steamId) {
      await interaction.reply({
        content: "Provide a Discord user and/or Steam ID to remove.",
        ephemeral: true,
      });
      return;
    }

    const result = await internalPost<{ removed: boolean }>(
      "/internal/blacklist/remove",
      interaction.user.id,
      {
        guildId: interaction.guildId,
        targetDiscordId: user?.id,
        steamId: steamId ?? undefined,
      },
    );

    await replyEmbed(
      interaction,
      {
        title: result.removed ? "Removed from blacklist" : "Not found",
        description: result.removed
          ? "The user was removed from the blacklist."
          : "No matching blacklist entry found.",
        color: result.removed ? 0x3dd68c : 0x5865f2,
        footer: { text: "RustTools" },
      },
      { ephemeral: true },
    );
  }
}

async function main() {
  if (!env.botToken) throw new Error("DISCORD_BOT_TOKEN is required");
  if (!env.internalApiKey) throw new Error("INTERNAL_API_KEY is required");

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`Discord bot logged in as ${c.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === "switch") {
        await handleDeviceAutocomplete(interaction, "smart_switch");
        return;
      }
      if (interaction.commandName === "storage") {
        await handleDeviceAutocomplete(interaction, "storage_monitor");
        return;
      }
      return;
    }

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
        const message = err instanceof Error ? err.message : "Failed to load recycle breakdown";
        const embed =
          err instanceof ApiError && err.status === 403
            ? permissionDeniedEmbed(message)
            : errorEmbed(message);
        await interaction.reply({ embeds: [toApiEmbed(embed)], ephemeral: true });
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
        case "alias":
          await runBangCommand(
            interaction,
            buildAliasBangMessage(
              interaction.options.getString("name", true),
              interaction.options.getString("action"),
              interaction.options.getInteger("seconds"),
            ),
          );
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
        case "send": {
          const user = interaction.options.getUser("user", true);
          const message = interaction.options.getString("message", true);
          await runBangCommand(
            interaction,
            `!send ${user.username} ${message}`,
            { ephemeral: true },
          );
          break;
        }
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
        case "blacklist":
          await handleBlacklist(interaction);
          break;
        default:
          if (BANG_SLASH_COMMAND_NAMES.has(interaction.commandName)) {
            const bang = BANG_MESSAGE_BY_SLASH[interaction.commandName] ?? `!${interaction.commandName}`;
            const adminOnly = interaction.commandName === "mute" || interaction.commandName === "unmute";
            await runBangCommand(interaction, bang, { ephemeral: adminOnly });
            break;
          }
          await interaction.reply({ content: "Unknown command", ephemeral: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Command failed";
      const embed =
        err instanceof ApiError && err.status === 403
          ? permissionDeniedEmbed(message)
          : errorEmbed(message);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ embeds: [toApiEmbed(embed)], ephemeral: true });
      } else {
        await interaction.reply({ embeds: [toApiEmbed(embed)], ephemeral: true });
      }
    }
  });

  await client.login(env.botToken);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
