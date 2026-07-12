import type { MapCoordinateTransform } from "./map-coords.js";
import { worldToMapPixel } from "./map-coords.js";

/** In-game Rust map grid cell size in world units (meters). */
export const MAP_GRID_CELL_SIZE = 150;

export interface MapGridLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MapGridLabel {
  text: string;
  x: number;
  y: number;
}

/** Excel-style column labels: A, B, … Z, AA, AB, … */
export function gridColumnLabel(index: number): string {
  let label = "";
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

export function gridCellCount(worldSize: number): number {
  return Math.max(1, Math.ceil(worldSize / MAP_GRID_CELL_SIZE));
}

/** World coordinates → in-game grid label (e.g. G15). */
export function worldToGridLabel(x: number, y: number, worldSize: number): string {
  const cells = gridCellCount(worldSize);
  const col = Math.min(Math.max(0, Math.floor(x / MAP_GRID_CELL_SIZE)), cells - 1);
  const row = Math.min(Math.max(0, Math.floor(y / MAP_GRID_CELL_SIZE)), cells - 1);
  return `${gridColumnLabel(col)}${row}`;
}

/** Grid label plus rounded world coords, e.g. `G15 (1234, 567)`. */
export function formatWorldCoords(x: number, y: number, worldSize: number): string {
  return `${worldToGridLabel(x, y, worldSize)} (${Math.round(x)}, ${Math.round(y)})`;
}

export function buildMapGrid(
  transform: MapCoordinateTransform,
): { lines: MapGridLine[]; labels: MapGridLabel[] } {
  const { worldSize } = transform;
  const cells = gridCellCount(worldSize);
  const lines: MapGridLine[] = [];

  for (let i = 0; i <= cells; i++) {
    const worldCoord = Math.min(i * MAP_GRID_CELL_SIZE, worldSize);
    const startV = worldToMapPixel(0, worldCoord, transform);
    const endV = worldToMapPixel(worldSize, worldCoord, transform);
    lines.push({ x1: startV.x, y1: startV.y, x2: endV.x, y2: endV.y });

    const startH = worldToMapPixel(worldCoord, 0, transform);
    const endH = worldToMapPixel(worldCoord, worldSize, transform);
    lines.push({ x1: startH.x, y1: startH.y, x2: endH.x, y2: endH.y });
  }

  const labels: MapGridLabel[] = [];
  const labelInset = MAP_GRID_CELL_SIZE * 0.5;

  for (let col = 0; col < cells; col++) {
    const worldX = col * MAP_GRID_CELL_SIZE + labelInset;
    const worldY = worldSize - labelInset;
    const { x, y } = worldToMapPixel(worldX, worldY, transform);
    labels.push({ text: gridColumnLabel(col), x, y });
  }

  for (let row = 0; row < cells; row++) {
    const worldX = labelInset;
    const worldY = row * MAP_GRID_CELL_SIZE + labelInset;
    const { x, y } = worldToMapPixel(worldX, worldY, transform);
    labels.push({ text: String(row), x, y });
  }

  return { lines, labels };
}
