import type { RustPlusManager } from "@rusttools/rustplus-client";
import type { DeepSeaStatus } from "@rusttools/shared";
import { deepSeaTracker, monumentsFromMap } from "./deep-sea-tracker.js";

export async function fetchDeepSeaStatus(
  rustPlus: RustPlusManager,
  serverId: string,
): Promise<DeepSeaStatus> {
  try {
    const map = await rustPlus.getMap();
    const { status } = deepSeaTracker.process(serverId, {
      monuments: monumentsFromMap(map),
    });
    return status;
  } catch {
    return deepSeaTracker.getStatus(serverId);
  }
}
