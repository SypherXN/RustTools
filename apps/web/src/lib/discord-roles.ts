import { apiFetch } from "./api";

export interface DiscordGuildRole {
  id: string;
  name: string;
  color: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { roles: DiscordGuildRole[]; at: number } | null = null;
let inflight: Promise<DiscordGuildRole[]> | null = null;

/** Shared in-flight + TTL cache so multiple pickers do not hammer /discord/roles. */
export async function fetchDiscordGuildRoles(): Promise<DiscordGuildRole[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.roles;
  }
  if (inflight) return inflight;

  inflight = apiFetch<{ roles: DiscordGuildRole[] }>("/discord/roles")
    .then((data) => {
      cache = { roles: data.roles, at: Date.now() };
      return data.roles;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function invalidateDiscordGuildRolesCache(): void {
  cache = null;
}
