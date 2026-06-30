import { env } from "../config.js";

export interface DiscordGuildRole {
  id: string;
  name: string;
  color: number;
}

const GUILD_ROLES_CACHE_TTL_MS = 5 * 60 * 1000;

let guildRolesCache: { roles: DiscordGuildRole[]; expiresAt: number } | null = null;
let guildRolesInflight: Promise<DiscordGuildRole[]> | null = null;

function discordHeaders(): Record<string, string> {
  return {
    Authorization: `Bot ${env.discord.botToken}`,
    "Content-Type": "application/json",
  };
}

async function fetchGuildRolesFromDiscord(): Promise<DiscordGuildRole[] | null> {
  const guildId = env.discord.guildId;
  if (!guildId || !env.discord.botToken) return null;

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

export async function listDiscordGuildRoles(): Promise<DiscordGuildRole[]> {
  const now = Date.now();
  if (guildRolesCache && guildRolesCache.expiresAt > now) {
    return guildRolesCache.roles;
  }

  if (guildRolesInflight) return guildRolesInflight;

  guildRolesInflight = (async () => {
    try {
      const roles = await fetchGuildRolesFromDiscord();
      if (roles != null) {
        guildRolesCache = { roles, expiresAt: Date.now() + GUILD_ROLES_CACHE_TTL_MS };
        return roles;
      }
      if (guildRolesCache) return guildRolesCache.roles;
      return [];
    } catch (err) {
      if (guildRolesCache) return guildRolesCache.roles;
      throw err;
    } finally {
      guildRolesInflight = null;
    }
  })();

  return guildRolesInflight;
}
