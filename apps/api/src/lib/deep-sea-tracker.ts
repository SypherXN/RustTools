import {
  buildDeepSeaStatus,
  detectDeepSeaOpen,
  type DeepSeaDetectionResult,
  type DeepSeaPhase,
  type DeepSeaStatus,
} from "@rusttools/shared";
import { parseMapMarkers } from "./map-markers.js";
import { parseMonuments } from "./map-markers.js";

interface ServerDeepSeaState {
  phase: DeepSeaPhase;
  openedAt: number | null;
  closedAt: number | null;
  lastDetection: DeepSeaDetectionResult | null;
}

export type DeepSeaTransition = "opened" | "closed";

export class DeepSeaTracker {
  private readonly states = new Map<string, ServerDeepSeaState>();

  private getState(serverId: string): ServerDeepSeaState {
    const existing = this.states.get(serverId);
    if (existing) return existing;
    const initial: ServerDeepSeaState = {
      phase: "unknown",
      openedAt: null,
      closedAt: null,
      lastDetection: null,
    };
    this.states.set(serverId, initial);
    return initial;
  }

  getStatus(serverId: string, nowSec = Math.floor(Date.now() / 1000)): DeepSeaStatus {
    const state = this.getState(serverId);
    const detection = state.lastDetection;
    return buildDeepSeaStatus({
      phase: state.phase,
      isOpen: detection?.isOpen ?? state.phase === "open",
      offshoreVendingCount: detection?.offshoreVendingCount ?? 0,
      deepSeaMonumentCount: detection?.deepSeaMonumentCount ?? 0,
      openedAt: state.openedAt,
      closedAt: state.closedAt,
      nowSec,
    });
  }

  process(
    serverId: string,
    input: {
      markersRaw: unknown;
      monuments: Array<{ token: string }>;
      mapSize: number;
    },
    nowSec = Math.floor(Date.now() / 1000),
  ): { status: DeepSeaStatus; transition: DeepSeaTransition | null } {
    const state = this.getState(serverId);
    const parsedMarkers = parseMapMarkers(input.markersRaw).map((marker) => ({
      type: marker.type,
      x: marker.x,
      y: marker.y,
    }));

    const detection = detectDeepSeaOpen({
      markers: parsedMarkers,
      monuments: input.monuments,
      mapSize: input.mapSize,
    });
    state.lastDetection = detection;

    let transition: DeepSeaTransition | null = null;
    const wasOpen = state.phase === "open";

    if (detection.isOpen) {
      if (!wasOpen) {
        transition = "opened";
        state.openedAt = nowSec;
        state.closedAt = null;
      }
      state.phase = "open";
    } else if (state.phase === "open" || state.phase === "unknown") {
      if (wasOpen) {
        transition = "closed";
        state.closedAt = nowSec;
        state.openedAt = null;
      }
      state.phase = "closed";
    } else {
      state.phase = "closed";
    }

    return {
      status: this.getStatus(serverId, nowSec),
      transition,
    };
  }

  reset(serverId: string): void {
    this.states.delete(serverId);
  }
}

export function monumentsFromMap(map: unknown): Array<{ token: string }> {
  return parseMonuments(map).map((monument) => ({ token: monument.token }));
}

export const deepSeaTracker = new DeepSeaTracker();
