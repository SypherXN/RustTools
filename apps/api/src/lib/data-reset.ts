import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import {
  auditEvents,
  automationRuleTemplates,
  automationRules,
  deviceLibraryGroups,
  discordLiveEmbeds,
  mapDrawings,
  mapPins,
  rustEntities,
  rustServers,
  savedCameras,
  storageSnapshots,
  switchGroups,
  switchScheduledJobs,
  teamConnectionLog,
  teamDeathLog,
} from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import type { DataResetScope } from "@rusttools/shared";
import { getActiveServerId } from "./rust-data.js";

export async function executeDataReset(
  db: Database,
  rustPlus: RustPlusManager,
  scope: DataResetScope,
): Promise<{ scope: DataResetScope; detail: string }> {
  const serverId = await getActiveServerId(db);

  switch (scope) {
    case "team_events": {
      if (!serverId) return { scope, detail: "No active server — nothing to clear" };
      await db.delete(teamDeathLog).where(eq(teamDeathLog.serverId, serverId));
      await db.delete(teamConnectionLog).where(eq(teamConnectionLog.serverId, serverId));
      return { scope, detail: "Cleared team death and connection logs" };
    }
    case "world_event_state": {
      if (!serverId) return { scope, detail: "No active server — nothing to clear" };
      await db
        .update(rustServers)
        .set({ worldEventStateJson: null, updatedAt: new Date() })
        .where(eq(rustServers.id, serverId));
      return { scope, detail: "Reset world event tracker state" };
    }
    case "storage_history": {
      if (!serverId) return { scope, detail: "No active server — nothing to clear" };
      const entities = await db
        .select({ id: rustEntities.id })
        .from(rustEntities)
        .where(eq(rustEntities.serverId, serverId));
      const entityIds = entities.map((e) => e.id);
      if (entityIds.length) {
        await db.delete(storageSnapshots).where(inArray(storageSnapshots.entityId, entityIds));
      }
      return { scope, detail: `Cleared storage snapshots (${entityIds.length} devices)` };
    }
    case "map_overlays": {
      if (!serverId) return { scope, detail: "No active server — nothing to clear" };
      await db.delete(mapDrawings).where(eq(mapDrawings.serverId, serverId));
      await db.delete(mapPins).where(eq(mapPins.serverId, serverId));
      return { scope, detail: "Cleared map drawings and base pins" };
    }
    case "automation_rules": {
      if (!serverId) return { scope, detail: "No active server — nothing to clear" };
      await db.delete(automationRules).where(eq(automationRules.serverId, serverId));
      await db.delete(automationRuleTemplates).where(eq(automationRuleTemplates.serverId, serverId));
      return { scope, detail: "Cleared automation rules and templates" };
    }
    case "smart_devices": {
      if (!serverId) return { scope, detail: "No active server — nothing to clear" };
      await db.delete(switchScheduledJobs).where(eq(switchScheduledJobs.serverId, serverId));
      await db.delete(automationRules).where(eq(automationRules.serverId, serverId));
      await db.delete(automationRuleTemplates).where(eq(automationRuleTemplates.serverId, serverId));
      await db.delete(savedCameras).where(eq(savedCameras.serverId, serverId));
      await db.delete(switchGroups).where(eq(switchGroups.serverId, serverId));
      await db.delete(deviceLibraryGroups).where(eq(deviceLibraryGroups.serverId, serverId));
      await db.delete(rustEntities).where(eq(rustEntities.serverId, serverId));
      return { scope, detail: "Removed paired devices, groups, library, and automations" };
    }
    case "server_pairing": {
      if (!serverId) return { scope, detail: "No active server paired" };
      await rustPlus.disconnectAll();
      await db.delete(rustServers).where(eq(rustServers.id, serverId));
      return { scope, detail: "Disconnected Rust+ and removed active server pairing" };
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
