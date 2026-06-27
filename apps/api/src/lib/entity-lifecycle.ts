import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import {
  deviceLibraryGroups,
  deviceLibraryMembers,
  rustEntities,
  savedCameras,
  switchGroupMembers,
  switchGroups,
} from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import {
  deleteAutomationRulesForServer,
  deleteAutomationRulesReferencingEntity,
  deleteAutomationRulesReferencingGroup,
} from "./automation-rule-cleanup.js";
import { runWithConcurrency } from "./concurrency.js";
import {
  clearLegacyAutomationEntityRefsForServer,
  scrubLegacyAutomationRustEntityRef,
} from "./notification-settings-scrub.js";
import { cancelSwitchRevertJobs } from "./switch-scheduler.js";

const entityRemovedListeners = new Set<(entityDbId: string) => void>();
const entityLastValidated = new Map<string, number>();
const RECONCILE_SKIP_MS = 9 * 60 * 1000;
const RECONCILE_CONCURRENCY = 5;

export function onEntityRemoved(listener: (entityDbId: string) => void): () => void {
  entityRemovedListeners.add(listener);
  return () => entityRemovedListeners.delete(listener);
}

function notifyEntityRemoved(entityDbId: string): void {
  for (const listener of entityRemovedListeners) {
    listener(entityDbId);
  }
}

function entityValidationKey(serverId: string, rustEntityId: number): string {
  return `${serverId}:${rustEntityId}`;
}

export function markEntityValidated(serverId: string, rustEntityId: number): void {
  entityLastValidated.set(entityValidationKey(serverId, rustEntityId), Date.now());
}

export function isStaleEntityError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("not found") ||
    msg.includes("invalid entity") ||
    msg.includes("entity does not") ||
    msg.includes("no entity") ||
    msg.includes("unknown entity")
  );
}

export async function pruneEmptySwitchGroups(db: Database, serverId: string): Promise<number> {
  const groups = await db
    .select({ id: switchGroups.id })
    .from(switchGroups)
    .where(eq(switchGroups.serverId, serverId));

  let removed = 0;
  for (const group of groups) {
    const [member] = await db
      .select({ entityId: switchGroupMembers.entityId })
      .from(switchGroupMembers)
      .where(eq(switchGroupMembers.groupId, group.id))
      .limit(1);
    if (member) continue;

    await deleteAutomationRulesReferencingGroup(db, serverId, group.id);
    await db.delete(switchGroups).where(eq(switchGroups.id, group.id));
    removed += 1;
  }
  return removed;
}

export async function pruneEmptyDeviceLibraryGroups(db: Database, serverId: string): Promise<number> {
  let removed = 0;
  let changed = true;

  while (changed) {
    changed = false;
    const groups = await db
      .select()
      .from(deviceLibraryGroups)
      .where(eq(deviceLibraryGroups.serverId, serverId));

    for (const group of groups) {
      const [member] = await db
        .select({ entityId: deviceLibraryMembers.entityId })
        .from(deviceLibraryMembers)
        .where(eq(deviceLibraryMembers.groupId, group.id))
        .limit(1);
      if (member) continue;

      const hasChildren = groups.some((child) => child.parentId === group.id);
      if (hasChildren) continue;

      await db.delete(deviceLibraryGroups).where(eq(deviceLibraryGroups.id, group.id));
      removed += 1;
      changed = true;
    }
  }

  return removed;
}

/** Remove a stale or unpaired entity and clean dependent groups and automation rules. */
export async function removeEntityRecord(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
  entityDbId: string,
): Promise<boolean> {
  const [entity] = await db
    .select({ id: rustEntities.id, entityId: rustEntities.entityId })
    .from(rustEntities)
    .where(eq(rustEntities.id, entityDbId))
    .limit(1);
  if (!entity) return false;

  await cancelSwitchRevertJobs(db, rustPlus, { entityDbId });
  await deleteAutomationRulesReferencingEntity(db, serverId, entityDbId);
  await scrubLegacyAutomationRustEntityRef(db, serverId, entity.entityId);
  await db.delete(rustEntities).where(eq(rustEntities.id, entityDbId));
  entityLastValidated.delete(entityValidationKey(serverId, entity.entityId));
  notifyEntityRemoved(entityDbId);
  await pruneEmptySwitchGroups(db, serverId);
  await pruneEmptyDeviceLibraryGroups(db, serverId);
  return true;
}

/**
 * Clear paired devices and wipe-scoped automation data.
 * Automation rule templates are kept across wipes.
 */
export async function clearPairedDevicesForServer(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
): Promise<void> {
  await cancelSwitchRevertJobs(db, rustPlus, { serverId });
  await deleteAutomationRulesForServer(db, serverId);
  await db.delete(savedCameras).where(eq(savedCameras.serverId, serverId));
  await db.delete(switchGroups).where(eq(switchGroups.serverId, serverId));
  await db.delete(deviceLibraryGroups).where(eq(deviceLibraryGroups.serverId, serverId));
  await db.delete(rustEntities).where(eq(rustEntities.serverId, serverId));
  await clearLegacyAutomationEntityRefsForServer(db, serverId);
  for (const key of [...entityLastValidated.keys()]) {
    if (key.startsWith(`${serverId}:`)) entityLastValidated.delete(key);
  }
}

export async function reconcileStaleEntities(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
): Promise<number> {
  const entities = await db
    .select()
    .from(rustEntities)
    .where(eq(rustEntities.serverId, serverId));

  let removed = 0;

  await runWithConcurrency(entities, RECONCILE_CONCURRENCY, async (entity) => {
    const key = entityValidationKey(serverId, entity.entityId);
    const lastOk = entityLastValidated.get(key);
    if (lastOk != null && Date.now() - lastOk < RECONCILE_SKIP_MS) return;

    try {
      await rustPlus.getEntityInfo(entity.entityId);
      entityLastValidated.set(key, Date.now());
    } catch (err) {
      if (!isStaleEntityError(err)) return;
      const deleted = await removeEntityRecord(db, rustPlus, serverId, entity.id);
      if (deleted) removed += 1;
    }
  });

  return removed;
}
