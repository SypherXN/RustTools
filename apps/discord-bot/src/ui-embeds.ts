import {
  parseStorageEntityInfo,
  sortTeamRoster,
  teamMemberStatus,
  worldToGridLabel,
  type ParsedTeamInfo,
} from "@rusttools/shared";
import type { EmbedPayload } from "./reply-embeds.js";

const COLORS = {
  primary: 0x5865f2,
  success: 0x3dd68c,
  error: 0xe85d2a,
  on: 0x3dd68c,
  off: 0x747f8d,
} as const;

export function devicesEmbed(
  devices: Array<{
    name: string;
    displayName?: string | null;
    entityType: string;
    entityId: number;
    switchValue?: boolean | null;
  }>,
): EmbedPayload {
  if (devices.length === 0) {
    return {
      title: "Paired devices",
      description: "No devices paired yet.",
      color: COLORS.primary,
      footer: { text: "RustTools" },
    };
  }

  const byType = new Map<string, string[]>();
  for (const d of devices) {
    const list = byType.get(d.entityType) ?? [];
    const label = d.displayName ?? d.name;
    let line = `**${label}** · \`${d.entityId}\``;
    if (d.entityType === "smart_switch") {
      const state =
        d.switchValue === true ? "**ON**" : d.switchValue === false ? "**OFF**" : "*unknown*";
      line += ` · ${state}`;
    }
    list.push(line);
    byType.set(d.entityType, list);
  }

  const fields = [...byType.entries()].map(([type, lines]) => ({
    name: type.replace(/_/g, " "),
    value: lines.join("\n"),
  }));

  return {
    title: "Paired devices",
    color: COLORS.primary,
    fields,
    footer: { text: `${devices.length} device${devices.length === 1 ? "" : "s"}` },
  };
}

export function switchResultEmbed(
  device: string,
  value: boolean | null,
  options?: { readOnly?: boolean },
): EmbedPayload {
  if (options?.readOnly) {
    const state = value === true ? "ON" : value === false ? "OFF" : "Unknown";
    return {
      title: `Switch — ${state}`,
      description: `**${device}** is **${state}**.`,
      color: value === true ? COLORS.on : value === false ? COLORS.off : COLORS.primary,
      footer: { text: "RustTools" },
      timestamp: new Date().toISOString(),
    };
  }

  return {
    title: value ? "Switch ON" : "Switch OFF",
    description: `**${device}** is now **${value ? "ON" : "OFF"}**.`,
    color: value ? COLORS.on : COLORS.off,
    footer: { text: "RustTools" },
    timestamp: new Date().toISOString(),
  };
}

export function alarmsEmbed(
  alarms: Array<{ name: string; entityId: number }>,
): EmbedPayload {
  if (alarms.length === 0) {
    return {
      title: "Smart alarms",
      description: "No smart alarms paired.",
      color: COLORS.primary,
      footer: { text: "RustTools" },
    };
  }

  return {
    title: "Smart alarms",
    description: alarms.map((a) => `• **${a.name}** · \`${a.entityId}\``).join("\n"),
    color: COLORS.primary,
    footer: { text: `${alarms.length} alarm${alarms.length === 1 ? "" : "s"}` },
  };
}

export function storageEmbed(deviceName: string, info: unknown): EmbedPayload {
  const parsed = parseStorageEntityInfo(info);
  const items = parsed.items
    .slice(0, 12)
    .map((item) => `• **${item.name}** ×${item.quantity}`)
    .join("\n");

  const fields: EmbedPayload["fields"] = [
    {
      name: "Contents",
      value: items || "_Empty_",
    },
  ];

  if (parsed.isToolCupboard && parsed.upkeep) {
    fields.push({
      name: "Upkeep",
      value: parsed.upkeep.label,
      inline: true,
    });
  }

  return {
    title: deviceName,
    color: parsed.isToolCupboard ? COLORS.primary : 0xe85d2a,
    fields,
    footer: { text: `${parsed.items.length} item type${parsed.items.length === 1 ? "" : "s"}` },
  };
}

export function teamRosterEmbed(team: ParsedTeamInfo, worldSize?: number): EmbedPayload {
  const members = sortTeamRoster(team.members);
  const online = members.filter((m) => {
    const s = teamMemberStatus(m);
    return s === "online" || s === "afk";
  });

  const lines = members.map((m) => {
    const status = teamMemberStatus(m);
    const leader = m.isLeader ? " · leader" : "";
    const grid =
      m.locationKnown && m.x != null && m.y != null && worldSize
        ? ` · ${worldToGridLabel(m.x, m.y, worldSize)}`
        : "";
    const state =
      status === "afk" ? "AFK" : status === "dead" ? "dead" : status === "offline" ? "offline" : "online";
    return `• **${m.name}** — ${state}${leader}${grid}`;
  });

  return {
    title: "Team roster",
    description: lines.join("\n") || "_No team data_",
    color: COLORS.primary,
    footer: { text: `${online.length} online · ${members.length} total` },
  };
}

export function timeEmbed(time: unknown): EmbedPayload {
  const data = time as {
    isDay?: boolean;
    time?: number | string;
    sunrise?: number;
    sunset?: number;
  };

  const hour = typeof data.time === "number" ? data.time : undefined;
  let isDay = data.isDay;
  if (isDay == null && hour != null && data.sunrise != null && data.sunset != null) {
    isDay = hour >= data.sunrise && hour < data.sunset;
  }

  let label: string | undefined;
  if (hour != null) {
    const h = Math.floor(hour);
    const m = Math.floor((hour - h) * 60);
    label = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  } else if (typeof data.time === "string") {
    label = data.time;
  }

  const phase = isDay === true ? "Day" : isDay === false ? "Night" : "Unknown";

  return {
    title: "In-game time",
    color: isDay ? 0xfaa61a : 0x5865f2,
    fields: [
      { name: "Time", value: label ?? "Unknown", inline: true },
      { name: "Phase", value: phase, inline: true },
    ],
    footer: { text: "RustTools" },
    timestamp: new Date().toISOString(),
  };
}

export function chatSentEmbed(): EmbedPayload {
  return {
    title: "Team message sent",
    description: "Your message was posted to in-game team chat.",
    color: COLORS.success,
    footer: { text: "RustTools" },
  };
}

export function linkAccountEmbed(webUrl: string): EmbedPayload {
  return {
    title: "Link your Steam identity",
    color: COLORS.primary,
    fields: [
      { name: "1", value: `Log in at ${webUrl}` },
      { name: "2", value: "Open **Settings → Account → Steam Identity**" },
      { name: "3", value: "Enter your Steam ID (F1 → `player.id`) or use the pairing flow" },
      {
        name: "Optional — companion Rust+",
        value:
          "If you need `!leader` while you hold in-game leader (bot is not leader), link **Companion Rust+** on the same page with credentials from local `fcm-register`.",
      },
    ],
    footer: { text: "Master server pairing is admin-only (Settings → Server & Map)" },
  };
}

export function channelSetEmbed(label: string, channelId: string, isInformation: boolean): EmbedPayload {
  return {
    title: "Channel linked",
    description: isInformation
      ? `<#${channelId}> is now the **${label}** channel. A live board was posted (refreshes every minute).`
      : `<#${channelId}> is now linked for **${label}**.`,
    color: COLORS.success,
    footer: { text: "RustTools" },
  };
}

export function blacklistEmbed(
  entries: Array<{ discordId: string | null; steamId: string | null; reason: string }>,
): EmbedPayload {
  if (entries.length === 0) {
    return {
      title: "Blacklist",
      description: "No blacklisted users.",
      color: COLORS.primary,
      footer: { text: "RustTools" },
    };
  }

  const lines = entries.map((entry) => {
    const who = entry.discordId
      ? `<@${entry.discordId}>`
      : entry.steamId
        ? `Steam \`${entry.steamId}\``
        : "Unknown";
    const reason = entry.reason ? ` — ${entry.reason}` : "";
    return `• ${who}${reason}`;
  });

  return {
    title: "Blacklist",
    description: lines.join("\n"),
    color: COLORS.primary,
    footer: { text: `${entries.length} entr${entries.length === 1 ? "y" : "ies"}` },
  };
}
