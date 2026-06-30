export interface DiscordPingOptions {
  pingEveryone?: boolean;
  pingRoleIds?: string[] | null | undefined;
}

/** Normalize stored role IDs to valid Discord snowflakes. */
export function normalizeDiscordRoleIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw).trim();
    if (!/^\d{17,20}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function formatDiscordRoleMention(roleId: string): string {
  const id = roleId.trim();
  if (!/^\d{17,20}$/.test(id)) return "";
  return `<@&${id}>`;
}

export function buildDiscordPingPrefix(ping: DiscordPingOptions): string {
  const parts: string[] = [];
  if (ping.pingEveryone) parts.push("@everyone");
  for (const roleId of normalizeDiscordRoleIds(ping.pingRoleIds)) {
    const mention = formatDiscordRoleMention(roleId);
    if (mention && !parts.includes(mention)) parts.push(mention);
  }
  return parts.join(" ");
}

/** Merge global notification defaults with optional per-device overrides. */
export function resolveDiscordPingOptions(
  globalPing: DiscordPingOptions,
  override?: DiscordPingOptions | null,
): DiscordPingOptions {
  return {
    pingEveryone: globalPing.pingEveryone === true || override?.pingEveryone === true,
    pingRoleIds: [
      ...normalizeDiscordRoleIds(globalPing.pingRoleIds),
      ...normalizeDiscordRoleIds(override?.pingRoleIds),
    ],
  };
}

export function buildDiscordPingContent(
  message: string | undefined,
  ping: DiscordPingOptions,
): string | undefined {
  const prefix = buildDiscordPingPrefix(ping);
  const body = message?.trim() ?? "";
  if (!prefix && !body) return undefined;
  if (!prefix) return body || undefined;
  if (!body) return prefix;
  return `${prefix} ${body}`;
}
