import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustServers } from "@rusttools/db";
import type { WorldEventStats } from "@rusttools/shared";
import { emptyWorldEventStats } from "@rusttools/shared";

interface PersistedWorldEventState {
  stats: WorldEventStats;
  oilSmallLastTriggeredAt: number | null;
  oilLargeLastTriggeredAt: number | null;
}

export async function loadWorldEventStats(
  db: Database,
  serverId: string,
): Promise<PersistedWorldEventState> {
  const [row] = await db
    .select({ worldEventStateJson: rustServers.worldEventStateJson })
    .from(rustServers)
    .where(eq(rustServers.id, serverId))
    .limit(1);

  if (!row?.worldEventStateJson?.trim()) {
    return {
      stats: emptyWorldEventStats(),
      oilSmallLastTriggeredAt: null,
      oilLargeLastTriggeredAt: null,
    };
  }

  try {
    const parsed = JSON.parse(row.worldEventStateJson) as Partial<PersistedWorldEventState>;
    return {
      stats: { ...emptyWorldEventStats(), ...parsed.stats },
      oilSmallLastTriggeredAt: parsed.oilSmallLastTriggeredAt ?? null,
      oilLargeLastTriggeredAt: parsed.oilLargeLastTriggeredAt ?? null,
    };
  } catch {
    return {
      stats: emptyWorldEventStats(),
      oilSmallLastTriggeredAt: null,
      oilLargeLastTriggeredAt: null,
    };
  }
}

export async function saveWorldEventStats(
  db: Database,
  serverId: string,
  state: PersistedWorldEventState,
): Promise<void> {
  await db
    .update(rustServers)
    .set({
      worldEventStateJson: JSON.stringify(state),
      updatedAt: new Date(),
    })
    .where(eq(rustServers.id, serverId));
}

export type { PersistedWorldEventState };
