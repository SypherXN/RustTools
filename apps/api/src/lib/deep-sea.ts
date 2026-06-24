import type { Database } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import type { DeepSeaStatus } from "@rusttools/shared";
import { getWorldSize } from "./rust-data.js";
import { deepSeaTracker, monumentsFromMap } from "./deep-sea-tracker.js";

export async function fetchDeepSeaStatus(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
): Promise<DeepSeaStatus> {
  void db;
  try {
    const [info, markers, map] = await Promise.all([
      rustPlus.getServerInfo(),
      rustPlus.getMapMarkers(),
      rustPlus.getMap(),
    ]);
    const mapSize = getWorldSize(info) || 4000;
    const { status } = deepSeaTracker.process(serverId, {
      markersRaw: markers,
      monuments: monumentsFromMap(map),
      mapSize,
    });
    return status;
  } catch {
    return deepSeaTracker.getStatus(serverId);
  }
}
