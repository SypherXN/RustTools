import { normalizeChatCommandAlias } from "./device-settings.js";

export type SwitchCommandAction = "toggle" | "on" | "off" | "status";

export interface ParsedSwitchCommand {
  alias: string;
  action: SwitchCommandAction;
  /** When set, revert to previous state after this many seconds. */
  timedSeconds?: number;
}

const DURATION_RE = /^(\d+)(s|m|h)?$/i;

export function parseDurationToken(token: string): number | null {
  const match = token.match(DURATION_RE);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = (match[2] ?? "s").toLowerCase();
  if (unit === "m") return value * 60;
  if (unit === "h") return value * 3600;
  return value;
}

/** Parse `!alias`, `!alias on`, `!alias off 60s`, etc. */
export function parseSwitchChatCommand(message: string): ParsedSwitchCommand | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith("!")) return null;

  const body = trimmed.slice(1).trim();
  if (!body) return null;

  const parts = body.split(/\s+/);
  const alias = normalizeChatCommandAlias(parts[0] ?? "");
  if (!alias) return null;

  const actionToken = (parts[1] ?? "toggle").toLowerCase();
  let action: SwitchCommandAction;
  if (actionToken === "on") action = "on";
  else if (actionToken === "off") action = "off";
  else if (actionToken === "status") action = "status";
  else if (actionToken === "toggle" || parts.length === 1) action = "toggle";
  else return null;

  let timedSeconds: number | undefined;
  if (parts.length >= 3 && (action === "on" || action === "off")) {
    const duration = parseDurationToken(parts[2] ?? "");
    if (duration == null) return null;
    timedSeconds = duration;
  }

  return { alias, action, timedSeconds };
}

/** Read ON/OFF from Rust+ `getEntityInfo` or `entityChanged` payload. */
export function parseSwitchEntityValue(info: unknown): boolean | null {
  if (info == null || typeof info !== "object") return null;
  const data = info as { value?: boolean; payload?: { value?: boolean } };
  if (typeof data.value === "boolean") return data.value;
  if (typeof data.payload?.value === "boolean") return data.payload.value;
  return null;
}
