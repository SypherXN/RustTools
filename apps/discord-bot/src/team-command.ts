import type { ChatInputCommandInteraction } from "discord.js";
import { internalFetch } from "./api.js";
import { replyTeamCommandChunks, replyWithEmbeds, type EmbedPayload } from "./reply-embeds.js";

export async function runBangCommand(
  interaction: ChatInputCommandInteraction,
  bangMessage: string,
  options?: { ephemeral?: boolean },
): Promise<void> {
  const ephemeral = options?.ephemeral ?? false;
  await interaction.deferReply({ ephemeral });

  const displayName =
    interaction.member && "displayName" in interaction.member && interaction.member.displayName
      ? interaction.member.displayName
      : interaction.user.displayName || interaction.user.username;

  const result = await internalFetch<{ replies: string[]; embeds?: EmbedPayload[] }>(
    "/internal/slash-command/execute",
    interaction.user.id,
    {
      json: {
        guildId: interaction.guildId,
        message: bangMessage,
        discordUsername: displayName,
      },
    },
  );

  if (result.embeds?.length) {
    await replyWithEmbeds(interaction, result.embeds, ephemeral);
    return;
  }

  await replyTeamCommandChunks(interaction, result.replies ?? [], ephemeral);
}

export function buildAliasBangMessage(
  alias: string,
  action?: string | null,
  seconds?: number | null,
): string {
  const name = alias.trim().replace(/^!+/, "");
  let msg = `!${name}`;
  if (action) msg += ` ${action}`;
  if (seconds != null && seconds > 0 && (action === "on" || action === "off")) {
    msg += ` ${seconds}s`;
  }
  return msg;
}
