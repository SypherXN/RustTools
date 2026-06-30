import type { CSSProperties } from "react";
import type { MapCoordinateTransform, MapProcgenLayers, ProcgenOverlayId } from "@rusttools/shared";
import { mapCoordinateScale } from "@rusttools/shared";
import { useAuthenticatedImageSrc } from "../hooks/useAuthenticatedImageSrc";

const OVERLAY_MAP: Array<{ layer: keyof MapProcgenLayers; id: ProcgenOverlayId; filter: string; opacity: number }> = [
  { layer: "buildingBlocked", id: "building-blocked", filter: "saturate(1.25) contrast(1.2)", opacity: 0.95 },
  { layer: "heatmapOres", id: "heatmap-ores", filter: "saturate(2.2) contrast(1.8) brightness(1.2)", opacity: 1 },
  { layer: "heatmapStones", id: "heatmap-stones", filter: "saturate(2) contrast(1.9) brightness(1.35)", opacity: 1 },
  { layer: "heatmapSulfur", id: "heatmap-sulfur", filter: "saturate(2.4) contrast(1.9) brightness(1.25)", opacity: 1 },
];

interface MapProcgenOverlaysProps {
  width: number;
  height: number;
  transform: MapCoordinateTransform;
  layers: MapProcgenLayers;
  procgenReady: boolean;
}

function ProcgenOverlayImage({ id, style }: { id: ProcgenOverlayId; style: CSSProperties }) {
  const src = useAuthenticatedImageSrc(`/servers/active/map/procgen/overlays/${id}`);
  if (!src) return null;

  return <img className="map-procgen-overlay" src={src} alt="" style={style} draggable={false} />;
}

export function MapProcgenOverlays({ transform, layers, procgenReady }: MapProcgenOverlaysProps) {
  if (!procgenReady) return null;

  const scale = mapCoordinateScale(transform);
  const worldPixels = transform.worldSize * scale;
  const overlayStyle: CSSProperties = {
    left: transform.oceanMargin,
    top: transform.imageHeight - transform.oceanMargin - worldPixels,
    width: worldPixels,
    height: worldPixels,
    transform: "scaleY(-1)",
    transformOrigin: "center",
  };

  return (
    <>
      {OVERLAY_MAP.filter(({ layer }) => layers[layer]).map(({ id, filter, opacity }) => (
        <ProcgenOverlayImage key={id} id={id} style={{ ...overlayStyle, filter, opacity }} />
      ))}
    </>
  );
}
