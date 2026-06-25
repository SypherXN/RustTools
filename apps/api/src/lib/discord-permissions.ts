import type { UserPermissions } from "@rusttools/shared";
import type { Database } from "@rusttools/db";
import { env } from "../config.js";
import { configuredGuildId } from "./discord-channels.js";
import { isDiscordBlacklisted } from "./discord-blacklist.js";

export type DiscordCapability = "admin" | "switch" | "view";

const CAPABILITY_ROLES: Record<DiscordCapability, string[]> = {
  admin: env.discord.roleAdmin,
  switch: [...env.discord.roleAdmin, ...env.discord.roleSwitch],
  view: [...env.discord.roleAdmin, ...env.discord.roleSwitch, ...env.discord.roleView],
};

export function rolesConfigured(): boolean {
  return (
    env.discord.roleAdmin.length > 0 ||
    env.discord.roleSwitch.length > 0 ||
    env.discord.roleView.length > 0
  );
}

export async function getDiscordMemberRoles(discordUserId: string): Promise<string[]> {
  if (!env.discord.botToken || !env.discord.guildId) {
    return [];
  }

  const res = await fetch(
    `https://discord.com/api/guilds/${env.discord.guildId}/members/${discordUserId}`,
    { headers: { Authorization: `Bot ${env.discord.botToken}` } },
  );

  if (!res.ok) {
    return [];
  }

  const member = (await res.json()) as { roles?: string[] };
  return member.roles ?? [];
}

function memberHasCapability(roles: string[], capability: DiscordCapability): boolean {
  const allowed = [...new Set(CAPABILITY_ROLES[capability])];
  return roles.some((role) => allowed.includes(role));
}

export async function hasDiscordCapability(
  discordUserId: string,
  capability: DiscordCapability,
): Promise<boolean> {
  if (!rolesConfigured()) {
    return true;
  }

  const roles = await getDiscordMemberRoles(discordUserId);
  return memberHasCapability(roles, capability);
}

export async function resolveUserPermissions(discordUserId: string): Promise<UserPermissions> {
  const configured = rolesConfigured();
  if (!configured) {
    return {
      view: true,
      switch: true,
      admin: true,
      rolesConfigured: false,
    };
  }

  const roles = await getDiscordMemberRoles(discordUserId);
  return {
    view: memberHasCapability(roles, "view"),
    switch: memberHasCapability(roles, "switch"),
    admin: memberHasCapability(roles, "admin"),
    rolesConfigured: true,
  };
}

export function assertInternalApiKey(authHeader?: string): boolean {
  if (!env.internalApiKey) return false;
  return authHeader === `Bearer ${env.internalApiKey}`;
}

export async function requireDiscordCapability(
  discordUserId: string | undefined,
  capability: DiscordCapability,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!discordUserId) {
    return { ok: false, error: "discordUserId is required" };
  }
  if (!(await hasDiscordCapability(discordUserId, capability))) {
    return { ok: false, error: `Missing ${capability} permission` };
  }
  return { ok: true };
}

export async function requireDiscordBotAccess(
  db: Database,
  discordUserId: string | undefined,
  capability: DiscordCapability,
  guildId?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const perm = await requireDiscordCapability(discordUserId, capability);
  if (!perm.ok) return perm;

  const resolvedGuild = guildId?.trim() || configuredGuildId();
  if (resolvedGuild && discordUserId) {
    const blocked = await isDiscordBlacklisted(db, resolvedGuild, {
      discordId: discordUserId,
    });
    if (blocked) {
      return { ok: false, error: "You are blacklisted from RustTools commands" };
    }
  }

  return { ok: true };
}
