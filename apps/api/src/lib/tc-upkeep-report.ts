import { and, eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import {
  buildTcUpkeepReportEntry,
  formatUpkeepDetailReport,
  parseStorageEntityInfo,
  type TcUpkeepReportEntry,
} from "@rusttools/shared";

export async function fetchTcUpkeepReportEntries(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
): Promise<TcUpkeepReportEntry[]> {
  const monitors = await db
    .select()
    .from(rustEntities)
    .where(
      and(
        eq(rustEntities.serverId, serverId),
        eq(rustEntities.entityType, "storage_monitor"),
      ),
    );

  const entries: TcUpkeepReportEntry[] = [];

  for (const monitor of monitors) {
    const name = monitor.displayName?.trim() || monitor.name;
    try {
      const info = await rustPlus.getEntityInfo(monitor.entityId);
      const parsed = parseStorageEntityInfo(info);
      const entry = buildTcUpkeepReportEntry(name, parsed);
      if (entry) entries.push(entry);
    } catch {
      const entry = buildTcUpkeepReportEntry(name, null, true);
      if (entry) entries.push(entry);
    }
  }

  return entries;
}

export async function buildUpkeepDetailTeamChatReplies(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
): Promise<string[]> {
  const entries = await fetchTcUpkeepReportEntries(db, rustPlus, serverId);
  return formatUpkeepDetailReport(entries);
}
