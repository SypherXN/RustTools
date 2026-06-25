import { useCallback, useEffect, useRef, useState } from "react";
import type { MapCoordinateTransform, MapDrawingPoint, MapDrawingStroke, MapPin } from "@rusttools/shared";
import { worldToMapPixel } from "@rusttools/shared";

export type MapAnnotateTool = "pen" | "pin";

interface MapDrawingLayerProps {
  width: number;
  height: number;
  transform: MapCoordinateTransform;
  drawings: MapDrawingStroke[];
  pins: MapPin[];
  visible: boolean;
  editMode: boolean;
  canEdit: boolean;
  tool: MapAnnotateTool;
  hasPendingPin: boolean;
  hasPendingDrawing: boolean;
  pendingPin?: { x: number; y: number } | null;
  pendingDrawing?: { points: MapDrawingPoint[] } | null;
  drawColor: string;
  pendingDrawingColor: string;
  onPendingPin?: (point: MapDrawingPoint) => void;
  onPendingDrawing?: (points: MapDrawingPoint[]) => void;
  onSelectPin?: (pin: MapPin) => void;
  onSelectDrawing?: (drawing: MapDrawingStroke) => void;
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

function eventToWorld(
  e: React.PointerEvent,
  svg: SVGSVGElement,
  width: number,
  height: number,
  transform: MapCoordinateTransform,
): MapDrawingPoint {
  const rect = svg.getBoundingClientRect();
  const scaleX = width / rect.width;
  const scaleY = height / rect.height;
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top) * scaleY;
  return pixelToWorld(px, py, transform);
}

function strokePointsToSvg(
  points: MapDrawingPoint[],
  transform: MapCoordinateTransform,
): string {
  return points
    .map((p) => worldToMapPixel(p.x, p.y, transform))
    .map((p) => `${p.x},${p.y}`)
    .join(" ");
}

function labelAnchor(points: MapDrawingPoint[]): MapDrawingPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  const mid = Math.floor(points.length / 2);
  return points[mid] ?? points[0]!;
}

export function MapDrawingLayer({
  width,
  height,
  transform,
  drawings,
  pins,
  visible,
  editMode,
  canEdit,
  tool,
  hasPendingPin,
  hasPendingDrawing,
  pendingPin,
  pendingDrawing,
  drawColor,
  pendingDrawingColor,
  onPendingPin,
  onPendingDrawing,
  onSelectPin,
  onSelectDrawing,
}: MapDrawingLayerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<MapDrawingPoint[]>([]);

  const canInteract = editMode && canEdit;
  const penActive = canInteract && tool === "pen" && !hasPendingDrawing;
  const pinActive = canInteract && tool === "pin" && !hasPendingPin;

  useEffect(() => {
    if (!editMode || tool !== "pen") {
      setDraft([]);
    }
  }, [editMode, tool]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!penActive) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const svg = svgRef.current;
      if (!svg) return;
      setDraft([eventToWorld(e, svg, width, height, transform)]);
    },
    [penActive, width, height, transform],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!penActive || draft.length === 0) return;
      e.stopPropagation();
      const svg = svgRef.current;
      if (!svg) return;
      const world = eventToWorld(e, svg, width, height, transform);
      setDraft((prev) => [...prev, world]);
    },
    [penActive, draft.length, width, height, transform],
  );

  const finishStroke = useCallback(() => {
    if (draft.length < 2) {
      setDraft([]);
      return;
    }
    const points = draft;
    setDraft([]);
    onPendingDrawing?.(points);
  }, [draft, onPendingDrawing]);

  const handleMapClick = useCallback(
    (e: React.PointerEvent) => {
      if (!pinActive) return;
      e.stopPropagation();
      const svg = svgRef.current;
      if (!svg) return;
      onPendingPin?.(eventToWorld(e, svg, width, height, transform));
    },
    [pinActive, width, height, transform, onPendingPin],
  );

  if (!visible) return null;

  return (
    <div className="map-drawing-wrap">
      <svg
        ref={svgRef}
        className={`map-drawing-layer${penActive || pinActive ? " editable" : ""}`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onPointerDown={penActive ? handlePointerDown : pinActive ? handleMapClick : undefined}
        onPointerMove={penActive ? handlePointerMove : undefined}
        onPointerUp={penActive ? finishStroke : undefined}
        onPointerLeave={penActive ? finishStroke : undefined}
      >
        {drawings.map((stroke) => {
          const pts = strokePointsToSvg(stroke.points, transform);
          const labelPoint = stroke.label ? labelAnchor(stroke.points) : null;
          const labelPixel = labelPoint ? worldToMapPixel(labelPoint.x, labelPoint.y, transform) : null;
          return (
            <g key={stroke.id}>
              <polyline
                points={pts}
                fill="none"
                stroke={stroke.color}
                strokeWidth={stroke.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                pointerEvents="stroke"
                style={{ cursor: pinActive ? "crosshair" : "pointer" }}
                onPointerDown={(e) => {
                  if (pinActive || penActive) return;
                  e.stopPropagation();
                  onSelectDrawing?.(stroke);
                }}
              />
              {labelPixel && (
                <text
                  x={labelPixel.x + 6}
                  y={labelPixel.y - 6}
                  fontSize={11}
                  fill={stroke.color}
                  stroke="#0f1419"
                  strokeWidth={3}
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {stroke.label}
                </text>
              )}
            </g>
          );
        })}
        {draft.length > 1 && (
          <polyline
            points={strokePointsToSvg(draft, transform)}
            fill="none"
            stroke={drawColor}
            strokeWidth={3}
            strokeLinecap="round"
            pointerEvents="none"
          />
        )}
        {pendingDrawing && (
          <polyline
            points={strokePointsToSvg(pendingDrawing.points, transform)}
            fill="none"
            stroke={pendingDrawingColor}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray="6 4"
            pointerEvents="none"
          />
        )}
        {pendingPin && (
          <g className="map-pin-marker map-pin-marker-pending" pointerEvents="none">
            {(() => {
              const { x, y } = worldToMapPixel(pendingPin.x, pendingPin.y, transform);
              return <circle cx={x} cy={y} r={8} fill="#eab308" stroke="#fff" strokeWidth={2} opacity={0.85} />;
            })()}
          </g>
        )}
        {pins.map((pin) => {
          const { x, y } = worldToMapPixel(pin.x, pin.y, transform);
          return (
            <g
              key={pin.id}
              className="map-pin-marker"
              onPointerDown={(e) => {
                if (pinActive) return;
                e.stopPropagation();
                onSelectPin?.(pin);
              }}
              style={{ cursor: pinActive ? "crosshair" : "pointer", pointerEvents: "auto" }}
            >
              <circle cx={x} cy={y} r={8} fill="#eab308" stroke="#fff" strokeWidth={2} />
              <text x={x + 10} y={y + 4} fontSize={11} fill="#fff" pointerEvents="none">
                {pin.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
