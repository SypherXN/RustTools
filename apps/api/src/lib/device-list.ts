import { and, eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { parseStorageEntityInfo, resolveStorageMonitorIcon } from "@rusttools/shared";
import { runWithConcurrency } from "./concurrency.js";
import { getSwitchState } from "./vending.js";

const SWITCH_STATE_READ_CONCURRENCY = 5;
const STORAGE_MONITOR_READ_CONCURRENCY = 5;

export async function listDeviceRows(db: Database, serverId: string | null) {
  return serverId
    ? await db.select().from(rustEntities).where(eq(rustEntities.serverId, serverId))
    : await db.select().from(rustEntities);
}

export async function fetchSwitchStatesByDbId(
  rustPlus: RustPlusManager,
  switches: Array<{ id: string; entityId: number }>,
  entityDbIds?: Set<string>,
): Promise<Record<string, boolean | null>> {
  const targets = entityDbIds
    ? switches.filter((sw) => entityDbIds.has(sw.id))
    : switches;

  const states: Record<string, boolean | null> = {};
  await runWithConcurrency(targets, SWITCH_STATE_READ_CONCURRENCY, async (sw) => {
    states[sw.id] = await getSwitchState(rustPlus, sw.entityId);
  });
  return states;
}

export async function fetchSwitchStateForEntityDbId(
  db: Database,
  rustPlus: RustPlusManager,
  entityDbId: string,
): Promise<boolean | null> {
  const [device] = await db
    .select()
    .from(rustEntities)
    .where(eq(rustEntities.id, entityDbId))
    .limit(1);
  if (!device || device.entityType !== "smart_switch") return null;
  return getSwitchState(rustPlus, device.entityId);
}

export function mergeSwitchStates<T extends { id: string; entityType: string }>(
  rows: T[],
  states: Record<string, boolean | null>,
): Array<T & { switchValue?: boolean | null }> {
  return rows.map((device) => {
    if (device.entityType !== "smart_switch") return device;
    return { ...device, switchValue: states[device.id] ?? null };
  });
}

export async function listStorageMonitorMetadata(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string | null,
) {
  const rows = await db
    .select()
    .from(rustEntities)
    .where(
      serverId
        ? and(eq(rustEntities.entityType, "storage_monitor"), eq(rustEntities.serverId, serverId))
        : eq(rustEntities.entityType, "storage_monitor"),
    );

  const enriched: Array<
    (typeof rows)[number] & {
      containerKind: ReturnType<typeof resolveStorageMonitorIcon>["kind"];
      iconShortname: string;
      iconUrl: string;
      iconName: string;
      iconAutoDetected: boolean;
    }
  > = [];

  await runWithConcurrency(rows, STORAGE_MONITOR_READ_CONCURRENCY, async (monitor) => {
    let parsed = null;
    try {
      const info = await rustPlus.getEntityInfo(monitor.entityId);
      parsed = parseStorageEntityInfo(info);
    } catch {
      // Rust+ offline or entity unreachable — fall back to saved icon / unknown kind.
    }

    const resolved = resolveStorageMonitorIcon({ savedIcon: monitor.icon, parsed });
    enriched.push({
      ...monitor,
      containerKind: resolved.kind,
      iconShortname: resolved.shortname,
      iconUrl: resolved.iconUrl,
      iconName: resolved.name,
      iconAutoDetected: resolved.autoDetected,
    });
  });

  return enriched;
}
