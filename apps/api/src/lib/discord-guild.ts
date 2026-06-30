import { env } from "../config.js";

export interface DiscordGuildRole {
  id: string;
  name: string;
  color: number;
}

function discordHeaders(): Record<string, string> {
  return {
    Authorization: `Bot ${env.discord.botToken}`,
    "Content-Type": "application/json",
  };
}

export async function listDiscordGuildRoles(): Promise<DiscordGuildRole[]> {
  const guildId = env.discord.guildId;
  if (!guildId || !env.discord.botToken) return [];

  const res = await fetch(`https://discord.com/api/guilds/${guildId}/roles`, {
    headers: discordHeaders(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord guild roles failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const roles = (await res.json()) as Array<{
    id: string;
    name: string;
    color: number;
    position: number;
  }>;

  return roles
    .filter((role) => role.name !== "@everyone")
    .sort((a, b) => b.position - a.position)
    .map((role) => ({ id: role.id, name: role.name, color: role.color }));
}
