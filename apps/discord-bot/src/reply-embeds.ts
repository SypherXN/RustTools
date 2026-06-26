import type { ChatInputCommandInteraction } from "discord.js";

export type EmbedPayload = {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
};

const MAX_EMBEDS_PER_MESSAGE = 10;

export function toApiEmbed(payload: EmbedPayload): import("discord.js").APIEmbed {
  return {
    title: payload.title,
    description: payload.description,
    color: payload.color,
    fields: payload.fields,
    footer: payload.footer,
    timestamp: payload.timestamp,
  };
}

const DISCORD_MAX = 1900;

export async function replyTeamCommandChunks(
  interaction: ChatInputCommandInteraction,
  replies: string[],
  ephemeral = false,
): Promise<void> {
  const parts = replies.map((r) => r.trim()).filter(Boolean);
  if (parts.length === 0) {
    await interaction.editReply({ content: "No response from server." });
    return;
  }

  const send = async (content: string, asFollowUp: boolean) => {
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += DISCORD_MAX) {
      chunks.push(content.slice(i, i + DISCORD_MAX));
    }
    for (let i = 0; i < chunks.length; i++) {
      const body = chunks[i]!;
      if (!asFollowUp && i === 0) {
        await interaction.editReply({ content: body });
      } else {
        await interaction.followUp({ content: body, ephemeral });
      }
    }
  };

  await send(parts[0]!, false);
  for (let i = 1; i < parts.length; i++) {
    await send(parts[i]!, true);
  }
}

export async function replyWithEmbeds(
  interaction: ChatInputCommandInteraction,
  embeds: EmbedPayload[],
  ephemeral = false,
): Promise<void> {
  const apiEmbeds = embeds.map(toApiEmbed);
  if (apiEmbeds.length === 0) {
    await interaction.editReply({ content: "No response from server." });
    return;
  }

  const firstBatch = apiEmbeds.slice(0, MAX_EMBEDS_PER_MESSAGE);
  await interaction.editReply({ embeds: firstBatch, content: null });

  for (let i = MAX_EMBEDS_PER_MESSAGE; i < apiEmbeds.length; i += MAX_EMBEDS_PER_MESSAGE) {
    await interaction.followUp({
      embeds: apiEmbeds.slice(i, i + MAX_EMBEDS_PER_MESSAGE),
      ephemeral,
    });
  }
}

export async function replyEmbed(
  interaction: ChatInputCommandInteraction,
  embed: EmbedPayload,
  options?: { ephemeral?: boolean; defer?: boolean },
): Promise<void> {
  const ephemeral = options?.ephemeral ?? false;
  if (options?.defer) {
    await interaction.deferReply({ ephemeral });
    await interaction.editReply({ embeds: [toApiEmbed(embed)] });
    return;
  }
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: [toApiEmbed(embed)], content: null });
    return;
  }
  await interaction.reply({ embeds: [toApiEmbed(embed)], ephemeral });
}

export function errorEmbed(message: string): EmbedPayload {
  return {
    title: "Command failed",
    description: message,
    color: 0xe85d2a,
    footer: { text: "RustTools" },
  };
}
