import type { WorldEventsStatus } from "./world-events.js";
import {
  formatCountdown,
  formatDurationSince,
  type OilRigKind,
} from "./world-events.js";

export type EventChatCommand =
  | "cargo"
  | "heli"
  | "chinook"
  | "large"
  | "small"
  | "vendor"
  | "bradley"
  | "convoy"
  | "events";

const EVENT_COMMANDS: Record<string, EventChatCommand> = {
  "!cargo": "cargo",
  "!heli": "heli",
  "!helicopter": "heli",
  "!patrol": "heli",
  "!chinook": "chinook",
  "!ch47": "chinook",
  "!large": "large",
  "!small": "small",
  "!vendor": "vendor",
  "!bradley": "bradley",
  "!convoy": "convoy",
  "!events": "events",
};

export function parseEventTeamChatCommand(message: string): EventChatCommand | null {
  const token = message.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return EVENT_COMMANDS[token] ?? null;
}

function formatEntityStatus(
  name: string,
  entity: {
    active: boolean;
    grid: string | null;
    sinceSec: number | null;
    egressInSec?: number | null;
  },
  nowSec: number,
  extra?: string,
): string {
  if (entity.active && entity.grid) {
    const since = formatDurationSince(entity.sinceSec, nowSec);
    let line = `RustTools ${name}: active @ ${entity.grid} (since ${since})`;
    if (entity.egressInSec != null && entity.egressInSec > 0) {
      const egress = formatCountdown(entity.egressInSec);
      if (egress) line += ` · egress in ${egress}`;
    }
    if (extra) line += ` · ${extra}`;
    return line;
  }
  const last = entity.sinceSec;
  if (last != null) {
    return `RustTools ${name}: not on map (last seen ${formatDurationSince(last, nowSec)})`;
  }
  return `RustTools ${name}: not on map`;
}

function formatOilRigStatus(kind: OilRigKind, status: WorldEventsStatus, nowSec: number): string {
  const rig = status.oilRigs[kind];
  const label = kind === "large" ? "Large Oil Rig" : "Small Oil Rig";
  if (rig.triggered && rig.crateUnlockInSec != null && rig.crateUnlockInSec > 0) {
    const unlock = rig.crateUnlockLabel ?? formatCountdown(rig.crateUnlockInSec);
    return `RustTools ${label}: triggered · crate unlocks in ${unlock}`;
  }
  if (rig.lastTriggeredAt != null) {
    return `RustTools ${label}: idle (last triggered ${formatDurationSince(rig.lastTriggeredAt, nowSec)})`;
  }
  return `RustTools ${label}: idle (not triggered this wipe)`;
}

export function formatEventChatCommandResponse(
  command: EventChatCommand,
  status: WorldEventsStatus,
  nowSec = Math.floor(Date.now() / 1000),
): string {
  switch (command) {
    case "cargo":
      return formatEntityStatus("Cargo", status.cargo, nowSec);
    case "heli": {
      const down = status.stats.heliLastDownAt;
      const extra =
        down != null && !status.heli.active
          ? `last down ${formatDurationSince(down, nowSec)}`
          : undefined;
      return formatEntityStatus("Patrol Heli", status.heli, nowSec, extra);
    }
    case "chinook":
      return formatEntityStatus("Chinook", status.chinook, nowSec);
    case "large":
      return formatOilRigStatus("large", status, nowSec);
    case "small":
      return formatOilRigStatus("small", status, nowSec);
    case "vendor":
      return formatEntityStatus("Traveling Vendor", status.vendor, nowSec);
    case "bradley":
      return formatEntityStatus("Bradley APC", status.bradley, nowSec);
    case "convoy":
      return formatEntityStatus("Convoy", status.convoy, nowSec);
    case "events": {
      const lines = [
        formatEntityStatus("Cargo", status.cargo, nowSec),
        formatEntityStatus("Heli", status.heli, nowSec),
        formatEntityStatus("Chinook", status.chinook, nowSec),
        formatEntityStatus("Vendor", status.vendor, nowSec),
        formatEntityStatus("Bradley", status.bradley, nowSec),
        formatEntityStatus("Convoy", status.convoy, nowSec),
        formatOilRigStatus("small", status, nowSec),
        formatOilRigStatus("large", status, nowSec),
      ];
      return lines.join("\n");
    }
    default:
      return "RustTools: Unknown event command.";
  }
}

export function isEventChatBotCommand(message: string): boolean {
  return parseEventTeamChatCommand(message) != null;
}
