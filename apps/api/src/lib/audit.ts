import type { Database } from "@rusttools/db";
import { auditEvents } from "@rusttools/db";
import { generateId } from "./ids.js";

export async function logAudit(
  db: Database,
  entry: {
    userId?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditEvents).values({
    id: generateId(),
    userId: entry.userId ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    createdAt: new Date(),
  });
}
