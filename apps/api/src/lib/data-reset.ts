import { and, eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import {
  auditEvents,
  automationRules,
  discordLiveEmbeds,
} from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import type { DataResetScope } from "@rusttools/shared";
import { clearMapAnnotationsForServer } from "./map-annotations.js";
import { clearPairedDevicesForServer } from "./entity-lifecycle.js";
import { getActiveServerId } from "./rust-data.js";
import { deleteRustServer } from "./rust-server-lifecycle.js";
import { resetWorldEventState } from "./server-wipe-cleanup.js";
import { clearAutomationBaseMapPin } from "./notification-settings-scrub.js";
import { clearTeamEventLogsForServer } from "./team-event-store.js";
import { clearTeamTrackerState } from "./team-tracker.js";
import { cancelSwitchRevertJobs } from "./switch-scheduler.js";

export async function executeDataReset(
  db: Database,
  rustPlus: RustPlusManager,
  scope: DataResetScope,
): Promise<{ scope: DataResetScope; detail: string }> {
  const serverId = await getActiveServerId(db);

  switch (scope) {
    case "team_events": {
      if (!serverId) return { scope, detail: "No active server — nothing to clear" };
      await clearTeamEventLogsForServer(db, serverId);
      clearTeamTrackerState(serverId);
      return { scope, detail: "Cleared team death and connection logs" };
    }
    case "world_event_state": {
      if (!serverId) return { scope, detail: "No active server — nothing to clear" };
      await resetWorldEventState(db, serverId);
      return { scope, detail: "Reset world event tracker state" };
    }
    case "map_overlays": {
      if (!serverId) return { scope, detail: "No active server — nothing to clear" };
      await clearMapAnnotationsForServer(db, serverId);
      await clearAutomationBaseMapPin(db, serverId);
      return { scope, detail: "Cleared map drawings, pins, and pin screenshots" };
    }
    case "automation_rules": {
      if (!serverId) return { scope, detail: "No active server — nothing to clear" };
      await db.delete(automationRules).where(eq(automationRules.serverId, serverId));
      return { scope, detail: "Cleared automation rules (templates kept)" };
    }
    case "smart_devices": {
      if (!serverId) return { scope, detail: "No active server — nothing to clear" };
      await cancelSwitchRevertJobs(db, rustPlus, { serverId });
      await clearPairedDevicesForServer(db, rustPlus, serverId);
      return { scope, detail: "Removed paired devices, groups, library, rules, and cameras (templates kept)" };
    }
    case "server_pairing": {
      if (!serverId) return { scope, detail: "No active server paired" };
      const { name } = await deleteRustServer(db, rustPlus, serverId);
      return { scope, detail: `Disconnected Rust+ and removed server "${name}" and all connected data` };
    }
    case "audit_log": {
      await db.delete(auditEvents);
      return { scope, detail: "Cleared audit log" };
    }
    default:
      throw new Error(`Unknown reset scope: ${scope satisfies never}`);
  }
}

/** Remove stored live-embed message IDs (does not delete Discord messages). */
export async function clearLiveEmbedRecords(db: Database, guildId: string, purpose: string): Promise<void> {
  await db
    .delete(discordLiveEmbeds)
    .where(and(eq(discordLiveEmbeds.guildId, guildId), eq(discordLiveEmbeds.purpose, purpose)));
}
