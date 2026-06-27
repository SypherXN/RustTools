import { and, eq, lte } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities, switchScheduledJobs } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { generateId } from "./ids.js";
import { getSwitchState } from "./vending.js";

function switchRevertJobId(jobId: string): string {
  return `switch-revert-${jobId}`;
}

export async function cancelSwitchRevertJobs(
  db: Database,
  rustPlus: RustPlusManager,
  filter: { serverId?: string; entityDbId?: string },
): Promise<number> {
  const conditions = [];
  if (filter.entityDbId) {
    conditions.push(eq(switchScheduledJobs.entityId, filter.entityDbId));
  } else if (filter.serverId) {
    conditions.push(eq(switchScheduledJobs.serverId, filter.serverId));
  } else {
    return 0;
  }

  const jobs = await db
    .select({ id: switchScheduledJobs.id })
    .from(switchScheduledJobs)
    .where(conditions.length === 1 ? conditions[0]! : and(...conditions));

  for (const job of jobs) {
    rustPlus.jobScheduler.cancelDelayed(switchRevertJobId(job.id));
    await db.delete(switchScheduledJobs).where(eq(switchScheduledJobs.id, job.id));
  }

  return jobs.length;
}

export async function scheduleSwitchRevert(
  db: Database,
  rustPlus: RustPlusManager,
  opts: {
    serverId: string;
    entityDbId: string;
    rustEntityId: number;
    revertValue: boolean;
    delaySeconds: number;
  },
): Promise<void> {
  const runAt = new Date(Date.now() + opts.delaySeconds * 1000);
  const jobId = generateId();

  await db.insert(switchScheduledJobs).values({
    id: jobId,
    serverId: opts.serverId,
    entityId: opts.entityDbId,
    revertValue: opts.revertValue,
    runAt,
    createdAt: new Date(),
  });

  rustPlus.jobScheduler.scheduleOnce({
    id: switchRevertJobId(jobId),
    runAt: runAt.getTime(),
    run: async () => {
      await db.delete(switchScheduledJobs).where(eq(switchScheduledJobs.id, jobId));
      const [entity] = await db
        .select({ entityId: rustEntities.entityId })
        .from(rustEntities)
        .where(eq(rustEntities.id, opts.entityDbId))
        .limit(1);
      if (!entity || entity.entityId !== opts.rustEntityId) return;

      try {
        await rustPlus.toggleSwitch(opts.rustEntityId, opts.revertValue);
      } catch {
        // device offline
      }
    },
  });
}

export async function restorePendingSwitchJobs(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
): Promise<void> {
  const now = new Date();
  const pending = await db
    .select()
    .from(switchScheduledJobs)
    .where(and(eq(switchScheduledJobs.serverId, serverId), lte(switchScheduledJobs.runAt, now)));

  for (const job of pending) {
    const [entity] = await db
      .select()
      .from(rustEntities)
      .where(eq(rustEntities.id, job.entityId))
      .limit(1);
    if (entity) {
      try {
        await rustPlus.toggleSwitch(entity.entityId, job.revertValue);
      } catch {
        // ignore
      }
    }
    await db.delete(switchScheduledJobs).where(eq(switchScheduledJobs.id, job.id));
  }

  const future = await db
    .select()
    .from(switchScheduledJobs)
    .where(and(eq(switchScheduledJobs.serverId, serverId)));

  for (const job of future) {
    const [entity] = await db
      .select()
      .from(rustEntities)
      .where(eq(rustEntities.id, job.entityId))
      .limit(1);
    if (!entity) {
      rustPlus.jobScheduler.cancelDelayed(switchRevertJobId(job.id));
      await db.delete(switchScheduledJobs).where(eq(switchScheduledJobs.id, job.id));
      continue;
    }

    const runAtMs = job.runAt.getTime();
    if (runAtMs <= Date.now()) continue;

    const entityDbId = job.entityId;
    const rustEntityId = entity.entityId;
    const revertValue = job.revertValue;

    rustPlus.jobScheduler.scheduleOnce({
      id: switchRevertJobId(job.id),
      runAt: runAtMs,
      run: async () => {
        await db.delete(switchScheduledJobs).where(eq(switchScheduledJobs.id, job.id));
        const [current] = await db
          .select({ entityId: rustEntities.entityId })
          .from(rustEntities)
          .where(eq(rustEntities.id, entityDbId))
          .limit(1);
        if (!current || current.entityId !== rustEntityId) return;

        try {
          await rustPlus.toggleSwitch(rustEntityId, revertValue);
        } catch {
          // ignore
        }
      },
    });
  }
}

export async function readSwitchStatusLabel(
  rustPlus: RustPlusManager,
  entityId: number,
): Promise<string> {
  const state = await getSwitchState(rustPlus, entityId);
  if (state === null) return "unknown";
  return state ? "on" : "off";
}
