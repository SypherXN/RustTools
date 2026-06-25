import { useCallback, useRef, useState } from "react";
import type { MapCoordinateTransform, MapDrawingPoint, MapDrawingStroke, MapPin } from "@rusttools/shared";
import { worldToMapPixel } from "@rusttools/shared";
import { apiFetch } from "../lib/api";

interface MapDrawingLayerProps {
  width: number;
  height: number;
  transform: MapCoordinateTransform;
  drawings: MapDrawingStroke[];
  pins: MapPin[];
  enabled: boolean;
  canEdit: boolean;
  onDrawingsChange: (drawings: MapDrawingStroke[]) => void;
  onPinsChange: (pins: MapPin[]) => void;
  onSelectPin?: (pin: MapPin) => void;
}

function pixelToWorld(
  px: number,
  py: number,
  transform: MapCoordinateTransform,
): MapDrawingPoint {
  const { imageHeight, oceanMargin, worldSize } = transform;
  const scale = (transform.imageWidth - oceanMargin * 2) / worldSize;
  return {
    x: (px - oceanMargin) / scale,
    y: (imageHeight - oceanMargin - py) / scale,
  };
}

export function MapDrawingLayer({
  width,
  height,
  transform,
  drawings,
  pins,
  enabled,
  canEdit,
  onDrawingsChange,
  onPinsChange,
  onSelectPin,
}: MapDrawingLayerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<MapDrawingPoint[]>([]);
  const [tool, setTool] = useState<"pen" | "pin">("pen");

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || !canEdit) return;
      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const scaleX = width / rect.width;
      const scaleY = height / rect.height;
      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top) * scaleY;
      const world = pixelToWorld(px, py, transform);

      if (tool === "pin") {
        const label = window.prompt("Pin label", "Base")?.trim();
        if (!label) return;
        void apiFetch<MapPin>("/servers/active/map/pins", {
          method: "POST",
          body: JSON.stringify({ label, x: world.x, y: world.y }),
        }).then((pin) => onPinsChange([...pins, pin]));
        return;
      }

      e.currentTarget.setPointerCapture(e.pointerId);
      setDraft([world]);
    },
    [enabled, canEdit, width, height, transform, tool, pins, onPinsChange],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || !canEdit || draft.length === 0 || tool !== "pen") return;
      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const scaleX = width / rect.width;
      const scaleY = height / rect.height;
      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top) * scaleY;
      const world = pixelToWorld(px, py, transform);
      setDraft((prev) => [...prev, world]);
    },
    [enabled, canEdit, draft.length, tool, width, height, transform],
  );

  const finishStroke = useCallback(async () => {
    if (draft.length < 2) {
      setDraft([]);
      return;
    }
    const stroke = await apiFetch<MapDrawingStroke>("/servers/active/map/drawings", {
      method: "POST",
      body: JSON.stringify({
        tool: "pen",
        color: "#facc15",
        width: 3,
        points: draft,
      }),
    });
    onDrawingsChange([...drawings, stroke]);
    setDraft([]);
  }, [draft, drawings, onDrawingsChange]);

  if (!enabled && drawings.length === 0 && pins.length === 0) return null;

  return (
    <div className="map-drawing-wrap">
      {enabled && canEdit && (
        <div className="map-drawing-toolbar">
          <button
            type="button"
            className={`btn-secondary${tool === "pen" ? " active" : ""}`}
            onClick={() => setTool("pen")}
          >
            Draw
          </button>
          <button
            type="button"
            className={`btn-secondary${tool === "pin" ? " active" : ""}`}
            onClick={() => setTool("pin")}
          >
            Add pin
          </button>
        </div>
      )}
      <svg
        ref={svgRef}
        className={`map-drawing-layer${enabled && canEdit ? " editable" : ""}`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => void finishStroke()}
        onPointerLeave={() => void finishStroke()}
      >
        {drawings.map((stroke) => {
          const pts = stroke.points
            .map((p) => worldToMapPixel(p.x, p.y, transform))
            .map((p) => `${p.x},${p.y}`)
            .join(" ");
          return (
            <polyline
              key={stroke.id}
              points={pts}
              fill="none"
              stroke={stroke.color}
              strokeWidth={stroke.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
        {draft.length > 1 && (
          <polyline
            points={draft
              .map((p) => worldToMapPixel(p.x, p.y, transform))
              .map((p) => `${p.x},${p.y}`)
              .join(" ")}
            fill="none"
            stroke="#facc15"
            strokeWidth={3}
            strokeLinecap="round"
          />
        )}
        {pins.map((pin) => {
          const { x, y } = worldToMapPixel(pin.x, pin.y, transform);
          return (
            <g
              key={pin.id}
              className="map-pin-marker"
              onClick={() => onSelectPin?.(pin)}
              style={{ cursor: "pointer" }}
            >
              <circle cx={x} cy={y} r={8} fill="#eab308" stroke="#fff" strokeWidth={2} />
              <text x={x + 10} y={y + 4} fontSize={11} fill="#fff">
                {pin.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
