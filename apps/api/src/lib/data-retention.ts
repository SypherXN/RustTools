import { lt } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { auditEvents, sessions } from "@rusttools/db";

/** Audit log entries older than 30 days are pruned automatically. */
export const AUDIT_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function clearAuditLog(db: Database): Promise<number> {
  const result = await db.delete(auditEvents);
  return result.changes;
}

export async function pruneAuditLog(db: Database): Promise<number> {
  const cutoff = new Date(Date.now() - AUDIT_LOG_RETENTION_MS);
  const result = await db.delete(auditEvents).where(lt(auditEvents.createdAt, cutoff));
  return result.changes;
}

export async function pruneExpiredSessions(db: Database): Promise<number> {
  const now = new Date();
  const result = await db.delete(sessions).where(lt(sessions.expiresAt, now));
  return result.changes;
}

export async function runDataRetention(db: Database): Promise<{
  auditEvents: number;
  sessions: number;
}> {
  const [auditEventsRemoved, sessionsRemoved] = await Promise.all([
    pruneAuditLog(db),
    pruneExpiredSessions(db),
  ]);
  return {
    auditEvents: auditEventsRemoved,
    sessions: sessionsRemoved,
  };
}
