import { and, eq, lte } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities, switchScheduledJobs } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { generateId } from "./ids.js";
import { getSwitchState } from "./vending.js";

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
    id: `switch-revert-${jobId}`,
    runAt: runAt.getTime(),
    run: async () => {
      await db.delete(switchScheduledJobs).where(eq(switchScheduledJobs.id, jobId));
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
      await db.delete(switchScheduledJobs).where(eq(switchScheduledJobs.id, job.id));
      continue;
    }

    const runAtMs = job.runAt.getTime();
    if (runAtMs <= Date.now()) continue;

    rustPlus.jobScheduler.scheduleOnce({
      id: `switch-revert-${job.id}`,
      runAt: runAtMs,
      run: async () => {
        await db.delete(switchScheduledJobs).where(eq(switchScheduledJobs.id, job.id));
        try {
          await rustPlus.toggleSwitch(entity.entityId, job.revertValue);
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
