import { env } from "../config.js";

/** How long to trust cached Discord member roles before re-fetching. */
const MEMBER_ROLE_CACHE_TTL_MS = 2 * 60 * 1000;

interface MemberRoleCacheEntry {
  roles: string[];
  expiresAt: number;
}

const memberRoleCache = new Map<string, MemberRoleCacheEntry>();
const memberRoleInflight = new Map<string, Promise<string[]>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchMemberRolesFromDiscord(discordUserId: string): Promise<string[] | null> {
  const guildId = env.discord.guildId;
  const token = env.discord.botToken;
  if (!guildId || !token) return null;

  const url = `https://discord.com/api/guilds/${guildId}/members/${discordUserId}`;
  const headers = { Authorization: `Bot ${token}` };

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers });
    if (res.ok) {
      const member = (await res.json()) as { roles?: string[] };
      return member.roles ?? [];
    }
    if (res.status === 429 && attempt === 0) {
      const retryAfterSec = Number(res.headers.get("Retry-After") ?? "1");
      await sleep(Math.min(Math.max(retryAfterSec, 0.25), 5) * 1000);
      continue;
    }
    return null;
  }

  return null;
}

export async function getDiscordMemberRoles(discordUserId: string): Promise<string[]> {
  if (!env.discord.botToken || !env.discord.guildId) {
    return [];
  }

  const now = Date.now();
  const cached = memberRoleCache.get(discordUserId);
  if (cached && cached.expiresAt > now) {
    return cached.roles;
  }

  let inflight = memberRoleInflight.get(discordUserId);
  if (!inflight) {
    inflight = (async () => {
      const roles = await fetchMemberRolesFromDiscord(discordUserId);
      if (roles != null) {
        memberRoleCache.set(discordUserId, {
          roles,
          expiresAt: Date.now() + MEMBER_ROLE_CACHE_TTL_MS,
        });
        return roles;
      }
      // Discord hiccup — keep last known roles instead of denying access.
      if (cached) return cached.roles;
      return [];
    })().finally(() => {
      memberRoleInflight.delete(discordUserId);
    });
    memberRoleInflight.set(discordUserId, inflight);
  }

  return inflight;
}

export function invalidateDiscordMemberRoleCache(discordUserId?: string): void {
  if (discordUserId) {
    memberRoleCache.delete(discordUserId);
    return;
  }
  memberRoleCache.clear();
}
