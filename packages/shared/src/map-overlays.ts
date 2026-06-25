export type MapDrawingTool = "pen" | "line" | "arrow";

export interface MapDrawingPoint {
  x: number;
  y: number;
}

export interface MapDrawingStroke {
  id: string;
  tool: MapDrawingTool;
  label: string;
  color: string;
  width: number;
  points: MapDrawingPoint[];
  createdBy: string;
  createdAt: number;
}

export const MAP_DRAWING_COLORS = [
  { name: "Yellow", value: "#facc15" },
  { name: "Red", value: "#f87171" },
  { name: "Green", value: "#4ade80" },
  { name: "Blue", value: "#60a5fa" },
  { name: "White", value: "#f8fafc" },
  { name: "Orange", value: "#fb923c" },
  { name: "Pink", value: "#f472b6" },
  { name: "Purple", value: "#c084fc" },
] as const;

export interface MapPin {
  id: string;
  label: string;
  x: number;
  y: number;
  notes: string;
  screenshotUrl: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface MapOverlaysResponse {
  drawings: MapDrawingStroke[];
  pins: MapPin[];
}
