import type { Database } from "@rusttools/db";
import { runDataRetention } from "../lib/data-retention.js";

const RETENTION_INTERVAL_MS = 60 * 60 * 1000;

export function startDataRetention(db: Database): void {
  const tick = async () => {
    try {
      const result = await runDataRetention(db);
      if (result.auditEvents > 0 || result.sessions > 0) {
        console.log(
          `[DataRetention] Pruned ${result.auditEvents} audit event(s), ${result.sessions} expired session(s)`,
        );
      }
    } catch (err) {
      console.error("[DataRetention] Prune failed:", err);
    }
  };

  void tick();
  setInterval(() => void tick(), RETENTION_INTERVAL_MS);
}
