import type {
  DeepSeaStatus,
  EventChatCommand,
  RosterChatCommand,
  TcUpkeepReportEntry,
  WorldEventsStatus,
} from "@rusttools/shared";
import {
  formatCountdown,
  formatDeepSeaDiscordDescription,
  formatDurationSince,
  formatWebHelpCategories,
  sortTeamRoster,
  teamMemberStatus,
  type ParsedTeamInfo,
  worldToGridLabel,
} from "@rusttools/shared";
import type { DiscordEmbedPayload } from "./discord-messages.js";

export const EMBED_COLORS = {
  primary: 0x5865f2,
  success: 0x3dd68c,
  error: 0xe85d2a,
  warning: 0xfaa61a,
  muted: 0x747f8d,
  active: 0x3dd68c,
} as const;

function stripRustToolsPrefix(text: string): string {
  return text.replace(/^RustTools:\s*/i, "").trim();
}

function upkeepColor(level: TcUpkeepReportEntry["level"]): number {
  switch (level) {
    case "critical":
      return EMBED_COLORS.error;
    case "warning":
      return EMBED_COLORS.warning;
    default:
      return EMBED_COLORS.success;
  }
}

function formatEventField(
  label: string,
  entity: {
    active: boolean;
    grid: string | null;
    sinceSec: number | null;
    egressInSec?: number | null;
  },
  nowSec: number,
  extra?: string,
): { name: string; value: string; inline: boolean } {
  if (entity.active && entity.grid) {
    const since = formatDurationSince(entity.sinceSec, nowSec);
    let value = `**${entity.grid}** · since ${since}`;
    if (entity.egressInSec != null && entity.egressInSec > 0) {
      const egress = formatCountdown(entity.egressInSec);
      if (egress) value += `\nEgress in ${egress}`;
    }
    if (extra) value += `\n${extra}`;
    return { name: `${label} ● active`, value, inline: true };
  }
  if (entity.sinceSec != null) {
    return {
      name: label,
      value: `Offline · last ${formatDurationSince(entity.sinceSec, nowSec)}`,
      inline: true,
    };
  }
  return { name: label, value: "Not on map", inline: true };
}

function formatOilField(
  kind: "large" | "small",
  status: WorldEventsStatus,
  nowSec: number,
): { name: string; value: string; inline: boolean } {
  const rig = status.oilRigs[kind];
  const label = kind === "large" ? "Large Oil" : "Small Oil";
  if (rig.triggered && rig.crateUnlockInSec != null && rig.crateUnlockInSec > 0) {
    const unlock = rig.crateUnlockLabel ?? formatCountdown(rig.crateUnlockInSec);
    return { name: `${label} ● triggered`, value: `Crate unlocks in **${unlock}**`, inline: true };
  }
  if (rig.lastTriggeredAt != null) {
    return {
      name: label,
      value: `Idle · last ${formatDurationSince(rig.lastTriggeredAt, nowSec)}`,
      inline: true,
    };
  }
  return { name: label, value: "Idle · not triggered this wipe", inline: true };
}

export function buildNoticeEmbed(
  text: string,
  options?: { title?: string; kind?: "success" | "error" | "info" | "warning" },
): DiscordEmbedPayload {
  const body = stripRustToolsPrefix(text);
  const kind = options?.kind ?? inferNoticeKind(text);
  const color =
    kind === "success"
      ? EMBED_COLORS.success
      : kind === "error"
        ? EMBED_COLORS.error
        : kind === "warning"
          ? EMBED_COLORS.warning
          : EMBED_COLORS.primary;

  return {
    title: options?.title ?? "RustTools",
    description: body || text,
    color,
    footer: { text: "RustTools" },
    timestamp: new Date().toISOString(),
  };
}

function inferNoticeKind(text: string): "success" | "error" | "warning" | "info" {
  const lower = text.toLowerCase();
  if (
    lower.includes("only admins") ||
    lower.includes("blocked") ||
    lower.includes("unknown command") ||
    lower.includes("no linked") ||
    lower.includes("must be on the team") ||
    lower.includes("link your rust+")
  ) {
    return "error";
  }
  if (lower.includes("slow down") || lower.includes("muted")) return "warning";
  if (lower.includes("sent") || lower.includes("now team leader") || lower.includes("unmuted")) {
    return "success";
  }
  return "info";
}

export function buildRosterEmbed(
  filter: RosterChatCommand,
  team: ParsedTeamInfo,
  worldSize?: number,
): DiscordEmbedPayload {
  const labels: Record<RosterChatCommand, string> = {
    online: "Online",
    offline: "Offline",
    afk: "AFK",
    alive: "Alive",
  };

  const members = sortTeamRoster(team.members).filter((m) => {
    const status = teamMemberStatus(m);
    switch (filter) {
      case "online":
        return status === "online" || status === "afk";
      case "offline":
        return status === "offline";
      case "afk":
        return status === "afk";
      case "alive":
        return status === "online" || status === "afk";
      default:
        return false;
    }
  });

  const label = labels[filter];

  if (members.length === 0) {
    return {
      title: `${label} teammates`,
      description: `_No teammates ${label.toLowerCase()}._`,
      color: EMBED_COLORS.muted,
      footer: { text: "RustTools" },
    };
  }

  const lines = members.map((m) => {
    const status = teamMemberStatus(m);
    const leader = m.isLeader ? " · **leader**" : "";
    const grid =
      m.locationKnown && m.x != null && m.y != null && worldSize
        ? ` · **${worldToGridLabel(m.x, m.y, worldSize)}**`
        : "";
    const state =
      status === "afk" ? "AFK" : status === "dead" ? "dead" : status === "offline" ? "offline" : "online";
    return `• **${m.name}** — ${state}${leader}${grid}`;
  });

  return {
    title: `${label} teammates`,
    description: lines.join("\n"),
    color: EMBED_COLORS.primary,
    footer: { text: `${members.length} teammate${members.length === 1 ? "" : "s"}` },
  };
}

export function buildEventEmbed(
  command: EventChatCommand,
  status: WorldEventsStatus,
  nowSec = Math.floor(Date.now() / 1000),
): DiscordEmbedPayload {
  if (command === "events") {
    return buildEventsSummaryEmbed(status, nowSec);
  }

  if (command === "large" || command === "small") {
    const field = formatOilField(command, status, nowSec);
    const label = command === "large" ? "Large Oil Rig" : "Small Oil Rig";
    return {
      title: label,
      color: field.name.includes("●") ? EMBED_COLORS.active : EMBED_COLORS.muted,
      fields: [field],
      footer: { text: "RustTools" },
    };
  }

  const titles = {
    cargo: "Cargo Ship",
    heli: "Patrol Helicopter",
    chinook: "Chinook",
    vendor: "Traveling Vendor",
    bradley: "Bradley APC",
    convoy: "Convoy",
  } as const;

  const heliExtra =
    command === "heli" && status.stats.heliLastDownAt != null && !status.heli.active
      ? `Last down ${formatDurationSince(status.stats.heliLastDownAt, nowSec)}`
      : undefined;

  const entities = {
    cargo: status.cargo,
    heli: status.heli,
    chinook: status.chinook,
    vendor: status.vendor,
    bradley: status.bradley,
    convoy: status.convoy,
  } as const;

  const title = titles[command];
  const entity = entities[command];
  const field = formatEventField(title, entity, nowSec, heliExtra);

  return {
    title,
    color: field.name.includes("●") ? EMBED_COLORS.active : EMBED_COLORS.muted,
    fields: [field],
    footer: { text: "RustTools" },
  };
}

export function buildEventsSummaryEmbed(
  status: WorldEventsStatus,
  nowSec = Math.floor(Date.now() / 1000),
): DiscordEmbedPayload {
  const heliExtra =
    status.stats.heliLastDownAt != null && !status.heli.active
      ? `Last down ${formatDurationSince(status.stats.heliLastDownAt, nowSec)}`
      : undefined;

  const fields = [
    formatEventField("Cargo", status.cargo, nowSec),
    formatEventField("Patrol Heli", status.heli, nowSec, heliExtra),
    formatEventField("Chinook", status.chinook, nowSec),
    formatEventField("Vendor", status.vendor, nowSec),
    formatEventField("Bradley", status.bradley, nowSec),
    formatEventField("Convoy", status.convoy, nowSec),
    formatOilField("small", status, nowSec),
    formatOilField("large", status, nowSec),
  ];

  const activeCount = fields.filter((f) => f.name.includes("●")).length;

  return {
    title: "World events",
    color: activeCount > 0 ? EMBED_COLORS.primary : EMBED_COLORS.muted,
    fields,
    footer: { text: `${activeCount} active · RustTools` },
  };
}

export function buildUpkeepEmbed(entries: TcUpkeepReportEntry[]): DiscordEmbedPayload {
  if (entries.length === 0) {
    return {
      title: "Tool cupboard upkeep",
      description: "No linked tool cupboard storage monitors.",
      color: EMBED_COLORS.muted,
      footer: { text: "RustTools" },
    };
  }

  const sorted = [...entries].sort((a, b) => {
    if (a.unreachable && !b.unreachable) return 1;
    if (!a.unreachable && b.unreachable) return -1;
    return a.secondsRemaining - b.secondsRemaining;
  });

  const worst = sorted.reduce<TcUpkeepReportEntry["level"]>(
    (acc, e) => (e.level === "critical" || acc === "critical" ? "critical" : e.level === "warning" || acc === "warning" ? "warning" : acc),
    "ok",
  );

  const fields = sorted.slice(0, 25).map((entry) => {
    if (entry.unreachable) {
      return { name: entry.name, value: "Offline / unreachable", inline: true };
    }
    const mats = entry.materials
      .map((m) => {
        const qty = m.quantity >= 1000 ? `${Math.round(m.quantity / 100) / 10}k` : String(m.quantity);
        return `${m.shortLabel}: **${qty}**`;
      })
      .join(" · ");
    return {
      name: entry.name,
      value: `**${entry.upkeepLabel}**${mats ? `\n${mats}` : ""}`,
      inline: true,
    };
  });

  return {
    title: "Tool cupboard upkeep",
    color: upkeepColor(worst),
    fields,
    footer: {
      text: `${sorted.length} monitor${sorted.length === 1 ? "" : "s"} · RustTools`,
    },
  };
}

export function buildDeepSeaEmbed(status: DeepSeaStatus): DiscordEmbedPayload {
  return {
    title: status.isOpen ? "Deep Sea — Open" : "Deep Sea — Closed",
    description: formatDeepSeaDiscordDescription(status),
    color: status.isOpen ? EMBED_COLORS.active : EMBED_COLORS.primary,
    footer: { text: "RustTools" },
    timestamp: new Date().toISOString(),
  };
}

export function buildTeamChatMirrorEmbed(
  senderName: string,
  message: string,
): DiscordEmbedPayload {
  const name = senderName.trim() || "Unknown";
  return {
    title: name,
    description: message,
    color: EMBED_COLORS.primary,
    footer: { text: "RustTools" },
  };
}

export function buildHelpTeamChatEmbed(): DiscordEmbedPayload {
  return {
    title: "Team chat commands",
    description: "These commands work in-game with `!`. In Discord, use the matching slash commands (`/help` for the full list).",
    color: EMBED_COLORS.primary,
    fields: formatWebHelpCategories().map((cat) => ({
      name: cat.name,
      value: cat.commands.map((c) => `\`${c}\``).join(" · "),
    })),
    footer: { text: "RustTools" },
  };
}

export function buildSwitchReplyEmbed(reply: string): DiscordEmbedPayload {
  const body = stripRustToolsPrefix(reply);
  const isStatus = body.toLowerCase().startsWith("switch is");
  const isGroup = body.toLowerCase().startsWith("group ");

  let title = "Switch";

  if (body.toLowerCase().includes("no members")) {
    return buildNoticeEmbed(reply, { title: "Switch group", kind: "error" });
  }

  if (isGroup) {
    title = "Switch group";
  } else if (isStatus) {
    title = "Switch status";
  }

  const color =
    body.includes("ON") && !body.includes("OFF for")
      ? EMBED_COLORS.success
      : body.includes("OFF")
        ? EMBED_COLORS.muted
        : EMBED_COLORS.primary;

  return {
    title,
    description: body,
    color,
    footer: { text: "RustTools" },
    timestamp: new Date().toISOString(),
  };
}
