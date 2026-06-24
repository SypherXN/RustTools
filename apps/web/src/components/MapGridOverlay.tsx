import type { MapCoordinateTransform } from "@rusttools/shared";
import { buildMapGrid } from "@rusttools/shared";

interface MapGridOverlayProps {
  width: number;
  height: number;
  transform: MapCoordinateTransform;
}

export function MapGridOverlay({ width, height, transform }: MapGridOverlayProps) {
  const { lines, labels } = buildMapGrid(transform);

  return (
    <svg
      className="map-overlay map-grid-overlay"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
    >
      <g className="map-grid-lines">
        {lines.map((line, i) => (
          <line
            key={i}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            className="map-grid-line"
          />
        ))}
      </g>
      <g className="map-grid-labels">
        {labels.map((label, i) => (
          <text
            key={`${label.text}-${i}`}
            x={label.x}
            y={label.y}
            className="map-grid-label"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {label.text}
          </text>
        ))}
      </g>
    </svg>
  );
}
