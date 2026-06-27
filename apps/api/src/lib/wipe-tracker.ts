import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustServers } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { parseServerMapMeta } from "@rusttools/shared";
import { parseWipeCountdown } from "./rust-data.js";
import { applyServerWipeCleanup } from "./server-wipe-cleanup.js";

export type WipeCheckResult =
  | { action: "initialized" }
  | { action: "unchanged" }
  | { action: "wiped"; previousSeed: number; newSeed: number };

/**
 * Detect map seed change (server wipe) and clear team logs, map annotations,
 * paired devices, automation rules, and saved cameras (templates are kept).
 * Initializes tracking on first run without clearing history.
 */
export async function checkServerWipe(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
  serverInfo: unknown,
): Promise<WipeCheckResult> {
  const mapMeta = parseServerMapMeta(serverInfo);
  const wipe = parseWipeCountdown(serverInfo);
  const seed = mapMeta.seed;
  const wipeAt = wipe.wipeAt;

  const [server] = await db
    .select({
      trackedMapSeed: rustServers.trackedMapSeed,
      trackedWipeAt: rustServers.trackedWipeAt,
    })
    .from(rustServers)
    .where(eq(rustServers.id, serverId))
    .limit(1);

  if (!server) {
    return { action: "unchanged" };
  }

  if (server.trackedMapSeed == null) {
    await db
      .update(rustServers)
      .set({
        trackedMapSeed: seed,
        trackedWipeAt: wipeAt,
        updatedAt: new Date(),
      })
      .where(eq(rustServers.id, serverId));
    return { action: "initialized" };
  }

  if (seed != null && server.trackedMapSeed !== seed) {
    await applyServerWipeCleanup(db, rustPlus, serverId);
    await db
      .update(rustServers)
      .set({
        trackedMapSeed: seed,
        trackedWipeAt: wipeAt,
        updatedAt: new Date(),
      })
      .where(eq(rustServers.id, serverId));
    console.log(
      `[WipeTracker] Map seed changed (${server.trackedMapSeed} → ${seed}); cleared wipe-scoped data for ${serverId}`,
    );
    return { action: "wiped", previousSeed: server.trackedMapSeed, newSeed: seed };
  }

  if (wipeAt != null && server.trackedWipeAt != null && wipeAt > server.trackedWipeAt + 3600) {
    // Wipe countdown reset sharply (seed unchanged — rare forced wipe / BP wipe)
    await applyServerWipeCleanup(db, rustPlus, serverId);
    await db
      .update(rustServers)
      .set({
        trackedMapSeed: seed ?? server.trackedMapSeed,
        trackedWipeAt: wipeAt,
        updatedAt: new Date(),
      })
      .where(eq(rustServers.id, serverId));
    console.log(`[WipeTracker] Wipe timer reset; cleared wipe-scoped data for ${serverId}`);
    return {
      action: "wiped",
      previousSeed: server.trackedMapSeed,
      newSeed: seed ?? server.trackedMapSeed,
    };
  }

  if (wipeAt !== server.trackedWipeAt) {
    await db
      .update(rustServers)
      .set({ trackedWipeAt: wipeAt, updatedAt: new Date() })
      .where(eq(rustServers.id, serverId));
  }

  return { action: "unchanged" };
}
