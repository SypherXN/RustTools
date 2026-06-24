const MARKER_TYPE_VENDING = 3;

export type DeepSeaPhase = "open" | "closed" | "unknown";

export interface DeepSeaDetectionInput {
  markers: Array<{ type: number; x: number; y: number }>;
  monuments: Array<{ token: string }>;
  mapSize: number;
  minOffshoreVendings?: number;
}

export interface DeepSeaDetectionResult {
  isOpen: boolean;
  offshoreVendingCount: number;
  deepSeaMonumentCount: number;
}

export interface DeepSeaStatus {
  phase: DeepSeaPhase;
  isOpen: boolean;
  offshoreVendingCount: number;
  deepSeaMonumentCount: number;
  openedAt: number | null;
  closedAt: number | null;
  nextTransitionAt: number | null;
  secondsRemaining: number | null;
  label: string;
  source: "detected" | "estimated";
}

export const DEFAULT_DEEP_SEA_OPEN_DURATION_SEC = 10_800;
export const DEFAULT_DEEP_SEA_COOLDOWN_SEC = 7_200;

export function deepSeaOpenDurationSec(): number {
  const raw = Number(process.env.DEEPSEA_OPEN_DURATION_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DEEP_SEA_OPEN_DURATION_SEC;
}

export function deepSeaCooldownSec(): number {
  const min = Number(process.env.DEEPSEA_COOLDOWN_MIN_SECONDS);
  const max = Number(process.env.DEEPSEA_COOLDOWN_MAX_SECONDS);
  if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min) {
    return Math.floor((min + max) / 2);
  }
  const single = Number(process.env.DEEPSEA_COOLDOWN_SECONDS);
  return Number.isFinite(single) && single > 0 ? single : DEFAULT_DEEP_SEA_COOLDOWN_SEC;
}

export function deepSeaTeamChatEnabled(): boolean {
  return process.env.AUTOMATION_DEEP_SEA_TEAM_CHAT === "true";
}

export function deepSeaDiscordEnabled(): boolean {
  const explicit = process.env.AUTOMATION_DEEP_SEA_DISCORD?.trim().toLowerCase();
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return deepSeaTeamChatEnabled();
}

export function isOffshoreWorldCoordinate(x: number, y: number, mapSize: number): boolean {
  return x < 0 || y < 0 || x > mapSize || y > mapSize;
}

export function isDeepSeaMonumentToken(token: string): boolean {
  return /deep[_\s-]?sea/i.test(token);
}

export function detectDeepSeaOpen(input: DeepSeaDetectionInput): DeepSeaDetectionResult {
  const minVendings = input.minOffshoreVendings ?? 1;
  let offshoreVendingCount = 0;

  for (const marker of input.markers) {
    if (marker.type !== MARKER_TYPE_VENDING) continue;
    if (isOffshoreWorldCoordinate(marker.x, marker.y, input.mapSize)) {
      offshoreVendingCount += 1;
    }
  }

  const deepSeaMonumentCount = input.monuments.filter((m) => isDeepSeaMonumentToken(m.token)).length;
  const isOpen = offshoreVendingCount >= minVendings || deepSeaMonumentCount > 0;

  return { isOpen, offshoreVendingCount, deepSeaMonumentCount };
}

export function formatDurationLabel(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function buildDeepSeaStatus(args: {
  phase: DeepSeaPhase;
  isOpen: boolean;
  offshoreVendingCount: number;
  deepSeaMonumentCount: number;
  openedAt: number | null;
  closedAt: number | null;
  nowSec?: number;
  openDurationSec?: number;
  cooldownSec?: number;
}): DeepSeaStatus {
  const nowSec = args.nowSec ?? Math.floor(Date.now() / 1000);
  const openDurationSec = args.openDurationSec ?? deepSeaOpenDurationSec();
  const cooldownSec = args.cooldownSec ?? deepSeaCooldownSec();

  let nextTransitionAt: number | null = null;
  let secondsRemaining: number | null = null;
  let label = "Status unknown";
  let source: DeepSeaStatus["source"] = "estimated";

  if (args.isOpen) {
    source = "detected";
    if (args.openedAt != null) {
      nextTransitionAt = args.openedAt + openDurationSec;
      secondsRemaining = Math.max(0, nextTransitionAt - nowSec);
      label =
        secondsRemaining > 0
          ? `Open — closes in ~${formatDurationLabel(secondsRemaining)}`
          : "Open — closing soon";
    } else {
      label = "Open";
    }
  } else if (args.phase === "closed") {
    if (args.closedAt != null) {
      nextTransitionAt = args.closedAt + cooldownSec;
      secondsRemaining = Math.max(0, nextTransitionAt - nowSec);
      label =
        secondsRemaining > 0
          ? `Closed — opens in ~${formatDurationLabel(secondsRemaining)}`
          : "Closed — opening soon";
    } else {
      label = "Closed";
    }
  }

  return {
    phase: args.phase,
    isOpen: args.isOpen,
    offshoreVendingCount: args.offshoreVendingCount,
    deepSeaMonumentCount: args.deepSeaMonumentCount,
    openedAt: args.openedAt,
    closedAt: args.closedAt,
    nextTransitionAt,
    secondsRemaining,
    label,
    source,
  };
}

export function formatDeepSeaTeamChatMessage(status: DeepSeaStatus): string {
  const prefix = process.env.AUTOMATION_EVENT_TEAM_CHAT_PREFIX?.trim() || "RustTools";
  if (status.isOpen) {
    const remaining =
      status.secondsRemaining != null
        ? ` (~${formatDurationLabel(status.secondsRemaining)} left)`
        : "";
    return `[${prefix}] Deep Sea is OPEN${remaining}`;
  }
  const remaining =
    status.secondsRemaining != null
      ? ` — opens in ~${formatDurationLabel(status.secondsRemaining)}`
      : "";
  return `[${prefix}] Deep Sea is CLOSED${remaining}`;
}

export function formatDeepSeaDiscordDescription(status: DeepSeaStatus): string {
  const lines = [status.label];
  if (status.offshoreVendingCount > 0) {
    lines.push(`Offshore vending machines: ${status.offshoreVendingCount}`);
  }
  if (status.deepSeaMonumentCount > 0) {
    lines.push(`Deep sea monuments: ${status.deepSeaMonumentCount}`);
  }
  return lines.join("\n");
}

export function parseDeepSeaTeamChatCommand(message: string): boolean {
  const text = message.trim().toLowerCase();
  return (
    text === "!deepsea" ||
    text === "!ds" ||
    text === "!when-deepsea" ||
    text.startsWith("!deepsea ") ||
    text.startsWith("!ds ")
  );
}
