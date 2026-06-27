import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { automationRules } from "@rusttools/db";
import type {
  AutomationAction,
  AutomationCondition,
  AutomationRuleRecord,
  AutomationTrigger,
} from "@rusttools/shared";

function parseRuleRow(row: typeof automationRules.$inferSelect): AutomationRuleRecord {
  return {
    id: row.id,
    serverId: row.serverId,
    name: row.name,
    enabled: row.enabled,
    trigger: JSON.parse(row.triggerJson) as AutomationTrigger,
    conditions: JSON.parse(row.conditionsJson) as AutomationCondition[],
    actions: JSON.parse(row.actionsJson) as AutomationAction[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function ruleReferencesEntity(rule: AutomationRuleRecord, entityId: string): boolean {
  if (rule.trigger.entityId === entityId) return true;
  if (rule.conditions.some((c) => c.entityId === entityId)) return true;
  if (rule.actions.some((a) => a.entityId === entityId)) return true;
  return false;
}

function ruleReferencesGroup(rule: AutomationRuleRecord, groupId: string): boolean {
  return rule.actions.some((a) => a.groupId === groupId);
}

function ruleReferencesMapPin(rule: AutomationRuleRecord, mapPinId: string): boolean {
  if (rule.trigger.mapPinId === mapPinId) return true;
  return rule.conditions.some((c) => c.mapPinId === mapPinId);
}

async function deleteMatchingRules(
  db: Database,
  serverId: string,
  predicate: (rule: AutomationRuleRecord) => boolean,
): Promise<number> {
  const rows = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.serverId, serverId));

  let removed = 0;
  for (const row of rows) {
    const rule = parseRuleRow(row);
    if (predicate(rule)) {
      await db.delete(automationRules).where(eq(automationRules.id, row.id));
      removed += 1;
    }
  }
  return removed;
}

export async function deleteAutomationRulesReferencingEntity(
  db: Database,
  serverId: string,
  entityId: string,
): Promise<number> {
  return deleteMatchingRules(db, serverId, (rule) => ruleReferencesEntity(rule, entityId));
}

export async function deleteAutomationRulesReferencingGroup(
  db: Database,
  serverId: string,
  groupId: string,
): Promise<number> {
  return deleteMatchingRules(db, serverId, (rule) => ruleReferencesGroup(rule, groupId));
}

export async function deleteAutomationRulesReferencingMapPin(
  db: Database,
  serverId: string,
  mapPinId: string,
): Promise<number> {
  return deleteMatchingRules(db, serverId, (rule) => ruleReferencesMapPin(rule, mapPinId));
}

export async function deleteAutomationRulesForServer(db: Database, serverId: string): Promise<void> {
  await db.delete(automationRules).where(eq(automationRules.serverId, serverId));
}
