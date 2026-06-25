export type ProcgenOverlayId =
  | "building-blocked"
  | "heatmap-ores"
  | "heatmap-stones"
  | "heatmap-sulfur";

export interface ProcgenPathNode {
  x: number;
  y: number;
  z: number;
}

export interface ProcgenPath {
  name: string;
  width: number;
  nodes: ProcgenPathNode[];
}

export interface ProcgenPrefabPoint {
  id: number;
  category: string;
  kind: "cave" | "iceberg" | "monument" | "other";
  label: string;
  x: number;
  y: number;
  z: number;
}

export interface ProcgenHeightData {
  resolution: number;
  worldSize: number;
  /** World Y in meters, row-major [z * resolution + x]. Rust range ~ -500..+500. */
  heights: number[];
  /** World Y water heights in meters, parallel to heights. Null when no water is present. */
  water: Array<number | null>;
  /** RGB 0–255 per vertex, parallel to heights. */
  colors: number[];
  minHeight: number;
  maxHeight: number;
}

export interface ProcgenParseResult {
  worldSize: number;
  version: number;
  overlays: Record<ProcgenOverlayId, Uint8Array>;
  overlaySize: number;
  paths: ProcgenPath[];
  prefabs: ProcgenPrefabPoint[];
  height: ProcgenHeightData;
}

export interface RgbaOverlay {
  width: number;
  height: number;
  data: Uint8Array;
}
