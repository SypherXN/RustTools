export interface MapCoordinateTransform {
  imageWidth: number;
  imageHeight: number;
  oceanMargin: number;
  worldSize: number;
}

const RUST_MAP_PADDING_WORLD = 2000;

export function buildMapTransform(
  map: { width?: number; height?: number; oceanMargin?: number },
  info: { mapSize?: number },
): MapCoordinateTransform {
  const imageWidth = map.width ?? 0;
  const imageHeight = map.height ?? imageWidth;
  const worldSize = info.mapSize ?? imageWidth;
  const oceanMargin =
    map.oceanMargin ??
    (worldSize > 0 && imageWidth > 0
      ? (Math.min(imageWidth, imageHeight) * (RUST_MAP_PADDING_WORLD / 2)) /
        (worldSize + RUST_MAP_PADDING_WORLD)
      : 0);

  return { imageWidth, imageHeight, oceanMargin, worldSize };
}

export function mapCoordinateScale(transform: MapCoordinateTransform): number {
  const { imageWidth, oceanMargin, worldSize } = transform;
  if (worldSize <= 0) return 1;
  return (imageWidth - oceanMargin * 2) / worldSize;
}

/** Convert Rust world coordinates to pixel coordinates on the map JPEG. */
export function worldToMapPixel(
  worldX: number,
  worldY: number,
  transform: MapCoordinateTransform,
): { x: number; y: number } {
  const { imageHeight, oceanMargin } = transform;
  const scale = mapCoordinateScale(transform);

  return {
    x: oceanMargin + worldX * scale,
    y: imageHeight - (oceanMargin + worldY * scale),
  };
}

export function worldLengthToMapPixels(length: number, transform: MapCoordinateTransform): number {
  return length * mapCoordinateScale(transform);
}

/** Rust+ reports map center for offline players when position is hidden. */
export function isHiddenTeamPosition(
  worldX: number,
  worldY: number,
  worldSize: number,
): boolean {
  const center = worldSize / 2;
  return Math.abs(worldX - center) < 1 && Math.abs(worldY - center) < 1;
}
