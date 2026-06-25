export type ProcgenOverlayId =
  | "building-blocked"
  | "heatmap-ores"
  | "heatmap-stones"
  | "heatmap-sulfur";

export interface ProcgenMapStatus {
  uploaded: boolean;
  uploadedAt: string | null;
  parsedAt: string | null;
  parseStatus: "pending" | "ready" | "error" | null;
  parseError: string | null;
  mapSeed: number | null;
  mapWorldSize: number | null;
  serverSeed: number | null;
  serverMapSize: number | null;
  seedMatch: boolean | null;
  sizeMatch: boolean | null;
  overlays: ProcgenOverlayId[];
}

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

export type FootprintPieceType = "foundation" | "floor" | "wall" | "doorway";

export interface FootprintPiece {
  type: FootprintPieceType;
  x: number;
  y: number;
  z: number;
  rotation: number;
}

export interface MapFootprint {
  id: string;
  label: string;
  pieces: FootprintPiece[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MapProcgenLayers {
  buildingBlocked: boolean;
  heatmapOres: boolean;
  heatmapStones: boolean;
  heatmapSulfur: boolean;
  paths: boolean;
  caves: boolean;
  icebergs: boolean;
}

export const DEFAULT_PROCGEN_LAYERS: MapProcgenLayers = {
  buildingBlocked: false,
  heatmapOres: false,
  heatmapStones: false,
  heatmapSulfur: false,
  paths: false,
  caves: false,
  icebergs: false,
};
