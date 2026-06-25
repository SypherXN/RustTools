import type { ParsedStorage, UpkeepLevel } from "./storage.js";
import { UPKEEP_SLOT_ORDER } from "./storage.js";

const MATERIAL_LABELS = ["W", "S", "M", "HQM"] as const;

export interface TcUpkeepReportEntry {
  name: string;
  secondsRemaining: number;
  upkeepLabel: string;
  level: UpkeepLevel;
  unreachable?: boolean;
  materials: Array<{
    shortLabel: string;
    quantity: number;
    projected24h: number | null;
  }>;
}

export function parseUpkeepDetailTeamChatCommand(message: string): boolean {
  const text = message.trim().toLowerCase();
  return text === "!upkeepdetail" || text.startsWith("!upkeepdetail ");
}

export function projectedUpkeep24h(quantity: number, secondsRemaining: number): number | null {
  if (secondsRemaining <= 0) return null;
  if (quantity <= 0) return 0;
  return Math.ceil((quantity * 86_400) / secondsRemaining);
}

export function formatCompactQuantity(value: number): string {
  const n = Math.max(0, Math.ceil(value));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function buildTcUpkeepReportEntry(
  name: string,
  parsed: ParsedStorage | null,
  unreachable = false,
): TcUpkeepReportEntry | null {
  if (!parsed?.isToolCupboard && !unreachable) return null;

  if (unreachable || !parsed) {
    return {
      name,
      secondsRemaining: Number.POSITIVE_INFINITY,
      upkeepLabel: "offline",
      level: "critical",
      unreachable: true,
      materials: [],
    };
  }

  const secondsRemaining = parsed.upkeep?.secondsRemaining ?? 0;
  const upkeepLabel = parsed.upkeep?.label ?? "unknown";
  const level = parsed.upkeep?.level ?? "critical";
  const slots = parsed.tcStorage?.upkeepSlots ?? [];

  const materials = UPKEEP_SLOT_ORDER.map((_, index) => {
    const quantity = slots[index]?.quantity ?? 0;
    return {
      shortLabel: MATERIAL_LABELS[index] ?? "?",
      quantity,
      projected24h: projectedUpkeep24h(quantity, secondsRemaining),
    };
  });

  return { name, secondsRemaining, upkeepLabel, level, materials };
}

function formatMaterialSegment(
  shortLabel: string,
  quantity: number,
  projected24h: number | null,
): string {
  const qty = formatCompactQuantity(quantity);
  if (projected24h == null) return `${shortLabel}:${qty}`;
  const proj = formatCompactQuantity(projected24h);
  return `${shortLabel}:${qty}(~${proj}/24h)`;
}

export function formatTcUpkeepReportLine(entry: TcUpkeepReportEntry, maxLength = 120): string {
  const safeName =
    entry.name.length > 24 ? `${entry.name.slice(0, 23)}…` : entry.name;

  if (entry.unreachable) {
    return `${safeName}: offline`;
  }

  const materials = entry.materials
    .map((material) =>
      formatMaterialSegment(material.shortLabel, material.quantity, material.projected24h),
    )
    .join(" ");

  const line = `${safeName}: ${entry.upkeepLabel} | ${materials}`;
  if (line.length <= maxLength) return line;
  return `${line.slice(0, maxLength - 1)}…`;
}

export function formatUpkeepDetailReport(entries: TcUpkeepReportEntry[]): string[] {
  if (entries.length === 0) {
    return ["RustTools: No linked tool cupboard storage monitors."];
  }

  const sorted = [...entries].sort((a, b) => {
    if (a.unreachable && !b.unreachable) return 1;
    if (!a.unreachable && b.unreachable) return -1;
    return a.secondsRemaining - b.secondsRemaining;
  });

  return [
    `RustTools TC upkeep (${sorted.length}):`,
    ...sorted.map((entry) => formatTcUpkeepReportLine(entry)),
  ];
}
