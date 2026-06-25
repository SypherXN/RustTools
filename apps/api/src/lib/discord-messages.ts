import { env } from "../config.js";

export interface DiscordEmbedPayload {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordMessagePayload {
  channelId: string;
  content?: string;
  embed?: DiscordEmbedPayload;
  components?: Array<{
    type: number;
    components: Array<{ type: number; style: number; label: string; custom_id: string }>;
  }>;
}

function discordHeaders(): Record<string, string> {
  return {
    Authorization: `Bot ${env.discord.botToken}`,
    "Content-Type": "application/json",
  };
}

export async function postDiscordMessage(
  payload: DiscordMessagePayload,
): Promise<{ id: string } | null> {
  if (!payload.channelId || !env.discord.botToken) return null;

  const res = await fetch(`https://discord.com/api/channels/${payload.channelId}/messages`, {
    method: "POST",
    headers: discordHeaders(),
    body: JSON.stringify({
      content: payload.content,
      embeds: payload.embed ? [payload.embed] : undefined,
      components: payload.components,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord POST message failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { id: string };
  return { id: data.id };
}

export async function editDiscordMessage(
  channelId: string,
  messageId: string,
  payload: Omit<DiscordMessagePayload, "channelId">,
): Promise<void> {
  if (!channelId || !messageId || !env.discord.botToken) return;

  const res = await fetch(
    `https://discord.com/api/channels/${channelId}/messages/${messageId}`,
    {
      method: "PATCH",
      headers: discordHeaders(),
      body: JSON.stringify({
        content: payload.content,
        embeds: payload.embed ? [payload.embed] : undefined,
        components: payload.components,
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord PATCH message failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

export async function deleteDiscordMessage(channelId: string, messageId: string): Promise<void> {
  if (!channelId || !messageId || !env.discord.botToken) return;

  const res = await fetch(
    `https://discord.com/api/channels/${channelId}/messages/${messageId}`,
    {
      method: "DELETE",
      headers: discordHeaders(),
    },
  );

  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord DELETE message failed (${res.status}): ${text.slice(0, 200)}`);
  }
}
