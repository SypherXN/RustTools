export const DISCORD_CHANNEL_PURPOSES = [
  "alarms",
  "team_chat",
  "events",
  "deep_sea",
  "storage",
  "default",
] as const;

export type DiscordChannelPurpose = (typeof DISCORD_CHANNEL_PURPOSES)[number];

export const DISCORD_CHANNEL_PURPOSE_LABELS: Record<DiscordChannelPurpose, string> = {
  alarms: "Smart alarms",
  team_chat: "Team chat mirror",
  events: "Map events (cargo, heli, chinook)",
  deep_sea: "Deep Sea open/close alerts",
  storage: "Storage monitor changes",
  default: "General notifications (fallback)",
};

export type DiscordChannelBindingSource = "database" | "env" | "none";

export interface DiscordChannelBinding {
  purpose: DiscordChannelPurpose;
  label: string;
  channelId: string | null;
  source: DiscordChannelBindingSource;
}

export function isDiscordChannelPurpose(value: string): value is DiscordChannelPurpose {
  return (DISCORD_CHANNEL_PURPOSES as readonly string[]).includes(value);
}
