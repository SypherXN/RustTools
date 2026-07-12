import type { RustPlusManager } from "@rusttools/rustplus-client";
import type { DeepSeaStatus } from "@rusttools/shared";
import { getWorldSize } from "./rust-data.js";
import { deepSeaTracker, monumentsFromMap } from "./deep-sea-tracker.js";

export async function fetchDeepSeaStatus(
  rustPlus: RustPlusManager,
  serverId: string,
): Promise<DeepSeaStatus> {
  try {
    const [info, map] = await Promise.all([rustPlus.getServerInfo(), rustPlus.getMap()]);
    const markersRaw = rustPlus.getLastMapMarkers() ?? (await rustPlus.getMapMarkers());
    const mapSize = getWorldSize(info) || 4000;
    const { status } = deepSeaTracker.process(serverId, {
      markersRaw,
      monuments: monumentsFromMap(map),
      mapSize,
    });
    return status;
  } catch {
    return deepSeaTracker.getStatus(serverId);
  }
}
