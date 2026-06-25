import { and, eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { discordGuildChannels } from "@rusttools/db";
import {
  DISCORD_CHANNEL_PURPOSES,
  DISCORD_CHANNEL_PURPOSE_LABELS,
  type DiscordChannelBinding,
  type DiscordChannelBindingSource,
  type DiscordChannelPurpose,
} from "@rusttools/shared";
import { env } from "../config.js";

const ENV_FALLBACKS: Record<DiscordChannelPurpose, string[]> = {
  alarms: ["DISCORD_ALARM_CHANNEL_ID", "DISCORD_NOTIFICATION_CHANNEL_ID"],
  team_chat: ["DISCORD_TEAM_CHAT_CHANNEL_ID", "DISCORD_NOTIFICATION_CHANNEL_ID"],
  commands: ["DISCORD_COMMANDS_CHANNEL_ID", "DISCORD_NOTIFICATION_CHANNEL_ID"],
  events: ["DISCORD_EVENT_CHANNEL_ID", "DISCORD_NOTIFICATION_CHANNEL_ID"],
  deep_sea: ["DISCORD_DEEP_SEA_CHANNEL_ID", "DISCORD_EVENT_CHANNEL_ID", "DISCORD_NOTIFICATION_CHANNEL_ID"],
  storage: ["DISCORD_NOTIFICATION_CHANNEL_ID"],
  default: ["DISCORD_NOTIFICATION_CHANNEL_ID"],
};

function envChannelForPurpose(purpose: DiscordChannelPurpose): string {
  for (const key of ENV_FALLBACKS[purpose]) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

export function configuredGuildId(): string {
  return env.discord.guildId.trim();
}

export function assertGuildAllowed(guildId: string): string | null {
  const configured = configuredGuildId();
  if (configured && guildId !== configured) {
    return "This RustTools instance is not configured for that Discord server";
  }
  return null;
}

async function dbChannelForPurpose(
  db: Database,
  guildId: string,
  purpose: DiscordChannelPurpose,
): Promise<string | null> {
  const [row] = await db
    .select({ channelId: discordGuildChannels.channelId })
    .from(discordGuildChannels)
    .where(and(eq(discordGuildChannels.guildId, guildId), eq(discordGuildChannels.purpose, purpose)))
    .limit(1);

  return row?.channelId?.trim() || null;
}

export async function resolveDiscordChannelId(
  db: Database,
  guildId: string,
  purpose: DiscordChannelPurpose,
): Promise<string> {
  if (!guildId) return envChannelForPurpose(purpose);

  const fromDb = await dbChannelForPurpose(db, guildId, purpose);
  if (fromDb) return fromDb;

  return envChannelForPurpose(purpose);
}

export async function resolveDefaultGuildChannelId(
  db: Database,
  purpose: DiscordChannelPurpose,
): Promise<string> {
  const guildId = configuredGuildId();
  if (guildId) {
    return resolveDiscordChannelId(db, guildId, purpose);
  }
  return envChannelForPurpose(purpose);
}

async function bindingForPurpose(
  db: Database,
  guildId: string,
  purpose: DiscordChannelPurpose,
): Promise<DiscordChannelBinding> {
  const fromDb = guildId ? await dbChannelForPurpose(db, guildId, purpose) : null;
  const fromEnv = envChannelForPurpose(purpose);

  let channelId: string | null = null;
  let source: DiscordChannelBindingSource = "none";

  if (fromDb) {
    channelId = fromDb;
    source = "database";
  } else if (fromEnv) {
    channelId = fromEnv;
    source = "env";
  }

  return {
    purpose,
    label: DISCORD_CHANNEL_PURPOSE_LABELS[purpose],
    channelId,
    source,
  };
}

export async function listDiscordChannelBindings(
  db: Database,
  guildId: string,
): Promise<DiscordChannelBinding[]> {
  return Promise.all(
    DISCORD_CHANNEL_PURPOSES.map((purpose) => bindingForPurpose(db, guildId, purpose)),
  );
}

export async function bindDiscordChannel(
  db: Database,
  guildId: string,
  purpose: DiscordChannelPurpose,
  channelId: string,
): Promise<void> {
  const now = new Date();
  await db
    .insert(discordGuildChannels)
    .values({
      guildId,
      purpose,
      channelId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [discordGuildChannels.guildId, discordGuildChannels.purpose],
      set: { channelId, updatedAt: now },
    });
}

export async function clearDiscordChannelBinding(
  db: Database,
  guildId: string,
  purpose: DiscordChannelPurpose,
): Promise<boolean> {
  const existing = await dbChannelForPurpose(db, guildId, purpose);
  if (!existing) return false;

  await db
    .delete(discordGuildChannels)
    .where(and(eq(discordGuildChannels.guildId, guildId), eq(discordGuildChannels.purpose, purpose)));

  return true;
}
