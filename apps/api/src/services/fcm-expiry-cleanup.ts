import type { Database } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { purgeExpiredFcmCredentials } from "../lib/fcm-credentials.js";

const CHECK_MS = 60 * 60 * 1000;

export function startFcmExpiryCleanup(db: Database, rustPlus: RustPlusManager): void {
  const tick = () => {
    void purgeExpiredFcmCredentials(db, rustPlus).catch((err) => {
      console.error("[FCM] Expiry cleanup failed:", err);
    });
  };

  tick();
  setInterval(tick, CHECK_MS).unref();
}
