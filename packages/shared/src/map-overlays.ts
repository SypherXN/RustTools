export type MapDrawingTool = "pen" | "line" | "arrow";

export interface MapDrawingPoint {
  x: number;
  y: number;
}

export interface MapDrawingStroke {
  id: string;
  tool: MapDrawingTool;
  color: string;
  width: number;
  points: MapDrawingPoint[];
  createdBy: string;
  createdAt: number;
}

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
