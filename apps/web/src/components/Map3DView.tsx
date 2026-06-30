import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type {
  MapCoordinateTransform,
  MapDrawingStroke,
  MapPin,
  MapProcgenLayers,
  ProcgenHeightData,
  ProcgenPath,
  ProcgenPrefabPoint,
  ResolvedAutomationBase,
} from "@rusttools/shared";
import { gridCellCount, gridColumnLabel, MAP_GRID_CELL_SIZE, mapCoordinateScale } from "@rusttools/shared";
import { fetchAuthenticatedBlob } from "../lib/authenticated-media";
import { apiFetch } from "../lib/api";
import type { MapLayers, MapMarkerPoint, MapMonument, MapTeamMember } from "./MapOverlay";
import { isMapEventMarkerVisible } from "./MapOverlay";
import type { MapFocusTarget, MapTrackTarget } from "./MapViewport";
import type { MapClusterContext, MapSelection, MarkerSelection } from "../lib/map-clusters";
import { resolveMapSelection } from "../lib/map-clusters";

const SEA_LEVEL = 0;
const WATER_LIFT = 0.35;
const SHOW_WATER = true;
const PROCGEN_OVERLAYS: Array<{ layer: keyof MapProcgenLayers; id: string; opacity: number }> = [
  { layer: "buildingBlocked", id: "building-blocked", opacity: 0.75 },
  { layer: "heatmapOres", id: "heatmap-ores", opacity: 1 },
  { layer: "heatmapStones", id: "heatmap-stones", opacity: 1 },
  { layer: "heatmapSulfur", id: "heatmap-sulfur", opacity: 1 },
];
type SelectableObject = THREE.Object3D & {
  userData: {
    selection?: MapSelection;
    worldX?: number;
    worldY?: number;
    markerSelection?: MarkerSelection;
  };
};

function pickSelectionFromHits(
  hits: THREE.Intersection[],
  clusterCtx: MapClusterContext,
): MapSelection | null {
  for (const hit of hits) {
    const obj = hit.object as SelectableObject;
    const { worldX, worldY, markerSelection, selection } = obj.userData;

    if (markerSelection != null && worldX != null && worldY != null) {
      return resolveMapSelection(worldX, worldY, markerSelection, clusterCtx);
    }

    if (selection?.kind === "pin" || selection?.kind === "drawing") {
      return selection;
    }
  }

  return null;
}

interface MapSelectionLookup {
  markers: MapMarkerPoint[];
  monuments: MapMonument[];
  team: MapTeamMember[];
  pins: MapPin[];
  drawings: MapDrawingStroke[];
}

function worldCoordsForSelection(
  selection: MapSelection,
  lookup: MapSelectionLookup,
): { worldX: number; worldY: number } | null {
  switch (selection.kind) {
    case "cluster":
      return { worldX: selection.x, worldY: selection.y };
    case "vending":
    case "event": {
      const marker = lookup.markers.find((m) => m.id === selection.markerId);
      return marker ? { worldX: marker.x, worldY: marker.y } : null;
    }
    case "monument": {
      const monument = lookup.monuments.find((m) => m.token === selection.token);
      return monument ? { worldX: monument.x, worldY: monument.y } : null;
    }
    case "team": {
      const member = lookup.team.find((m) => m.steamId === selection.steamId);
      return member?.x != null && member.y != null ? { worldX: member.x, worldY: member.y } : null;
    }
    case "pin": {
      const pin = lookup.pins.find((p) => p.id === selection.pinId);
      return pin ? { worldX: pin.x, worldY: pin.y } : null;
    }
    case "drawing": {
      const drawing = lookup.drawings.find((d) => d.id === selection.drawingId);
      if (!drawing?.points.length) return null;
      const mid = drawing.points[Math.floor(drawing.points.length / 2)] ?? drawing.points[0]!;
      return { worldX: mid.x, worldY: mid.y };
    }
    default:
      return null;
  }
}

interface CameraPersist {
  theta: number;
  phi: number;
  radius: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

interface CameraApi {
  focusWorld: (worldX: number, worldY: number) => void;
}

interface Map3DRuntime {
  dynamicGroup: THREE.Group;
  selectableObjects: SelectableObject[];
  clusterCtx: MapClusterContext;
  requestRender: () => void;
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  const materials = Array.isArray(material) ? material : [material];
  for (const entry of materials) {
    entry.dispose();
  }
}

function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((node) => {
    if (node instanceof THREE.Sprite) {
      const material = node.material as THREE.SpriteMaterial;
      material.map?.dispose();
      material.dispose();
      return;
    }
    if (node instanceof THREE.Line || node instanceof THREE.Mesh) {
      node.geometry?.dispose();
      disposeMaterial(node.material);
    }
  });
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObject3D(child);
  }
}

function boostTextureAlpha(texture: THREE.Texture, boost = 2.8): void {
  const image = texture.image as HTMLImageElement | undefined;
  if (!image?.width || !image.height) return;

  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.data.length; i += 4) {
    data.data[i] = Math.min(255, data.data[i] * boost);
  }
  ctx.putImageData(data, 0, 0);
  texture.image = canvas;
  texture.needsUpdate = true;
}

interface Map3DViewProps {
  worldSize: number;
  mapImageSrc: string | null;
  transform: MapCoordinateTransform;
  team: MapTeamMember[];
  markers: MapMarkerPoint[];
  monuments: MapMonument[];
  layers: MapLayers;
  drawings: MapDrawingStroke[];
  pins: MapPin[];
  showTeamOverlays: boolean;
  procgenLayers: MapProcgenLayers;
  procgenPaths: ProcgenPath[];
  procgenPrefabs: ProcgenPrefabPoint[];
  eventTrails?: {
    cargo: Array<{ x: number; y: number }>;
    heli: Array<{ x: number; y: number }>;
  };
  automationBase?: ResolvedAutomationBase | null;
  selection?: MapSelection | null;
  focusTarget?: MapFocusTarget | null;
  trackTarget?: MapTrackTarget | null;
  onUserPan?: () => void;
  onSelect?: (selection: MapSelection) => void;
}

function worldToSceneX(worldX: number, worldSize: number): number {
  return worldSize / 2 - worldX;
}

function worldToSceneZ(worldY: number, worldSize: number): number {
  return worldY - worldSize / 2;
}

function buildTerrainGeometry(terrain: ProcgenHeightData, transform: MapCoordinateTransform): THREE.BufferGeometry {
  const { resolution, worldSize, heights, colors } = terrain;
  const positions = new Float32Array(resolution * resolution * 3);
  const uvs = new Float32Array(resolution * resolution * 2);
  const colorAttr = new Float32Array(resolution * resolution * 3);
  const half = worldSize / 2;
  const scale = mapCoordinateScale(transform);

  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const idx = z * resolution + x;
      const worldX = (x / (resolution - 1)) * worldSize;
      const worldY = (z / (resolution - 1)) * worldSize;
      const imageU = transform.oceanMargin + worldX * scale;
      const imageVFromTop = transform.imageHeight - (transform.oceanMargin + worldY * scale);

      positions[idx * 3] = worldToSceneX(worldX, worldSize);
      positions[idx * 3 + 1] = heights[idx] ?? SEA_LEVEL;
      positions[idx * 3 + 2] = worldToSceneZ(worldY, worldSize);
      uvs[idx * 2] = imageU / transform.imageWidth;
      uvs[idx * 2 + 1] = 1 - imageVFromTop / transform.imageHeight;

      colorAttr[idx * 3] = (colors[idx * 3] ?? 74) / 255;
      colorAttr[idx * 3 + 1] = (colors[idx * 3 + 1] ?? 124) / 255;
      colorAttr[idx * 3 + 2] = (colors[idx * 3 + 2] ?? 63) / 255;
    }
  }

  const indices = new Uint32Array((resolution - 1) * (resolution - 1) * 6);
  let i = 0;
  for (let z = 0; z < resolution - 1; z++) {
    for (let x = 0; x < resolution - 1; x++) {
      const a = z * resolution + x;
      const b = a + 1;
      const c = (z + 1) * resolution + x;
      const d = c + 1;
      indices[i++] = a;
      indices[i++] = b;
      indices[i++] = c;
      indices[i++] = b;
      indices[i++] = d;
      indices[i++] = c;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute("color", new THREE.BufferAttribute(colorAttr, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  geo.boundingBox = new THREE.Box3(
    new THREE.Vector3(-half, terrain.minHeight, -half),
    new THREE.Vector3(half, terrain.maxHeight, half),
  );
  return geo;
}

function buildWaterGeometry(terrain: ProcgenHeightData): THREE.BufferGeometry | null {
  const { resolution, worldSize, water } = terrain;
  if (!water?.some((v) => v != null)) return null;

  const positions: number[] = [];
  const indices: number[] = [];
  const vertexIndex = new Map<number, number>();

  const addVertex = (x: number, z: number): number | null => {
    const idx = z * resolution + x;
    const waterY = water[idx];
    if (waterY == null) return null;
    const existing = vertexIndex.get(idx);
    if (existing != null) return existing;

    const worldX = (x / (resolution - 1)) * worldSize;
    const worldY = (z / (resolution - 1)) * worldSize;
    const vx = worldToSceneX(worldX, worldSize);
    const vz = worldToSceneZ(worldY, worldSize);
    const vi = positions.length / 3;
    positions.push(vx, waterY + WATER_LIFT, vz);
    vertexIndex.set(idx, vi);
    return vi;
  };

  for (let z = 0; z < resolution - 1; z++) {
    for (let x = 0; x < resolution - 1; x++) {
      const a = addVertex(x, z);
      const b = addVertex(x + 1, z);
      const c = addVertex(x, z + 1);
      const d = addVertex(x + 1, z + 1);
      if (a == null || b == null || c == null || d == null) continue;
      indices.push(a, b, c, b, d, c);
    }
  }

  if (indices.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeLabelSprite(text: string, color = "#ffffff"): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(15, 23, 42, 0.65)";
  ctx.beginPath();
  ctx.arc(64, 64, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = "bold 64px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 66);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(180, 180, 1);
  return sprite;
}

function makeMapMarkerSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(2, 6, 23, 0.72)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(12, 18, 232, 76, 18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(40, 56, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const label = text.length > 18 ? `${text.slice(0, 17)}…` : text;
  ctx.fillText(label, 64, 57);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(260, 130, 1);
  return sprite;
}

function addCardinalLabels(scene: THREE.Scene, worldSize: number, y: number): void {
  const half = worldSize / 2;
  const offset = 180;
  const labels: Array<[string, number, number, string]> = [
    ["N", 0, half + offset, "#38bdf8"],
    ["E", -half - offset, 0, "#fbbf24"],
    ["S", 0, -half - offset, "#fb7185"],
    ["W", half + offset, 0, "#a78bfa"],
  ];

  for (const [label, x, z, color] of labels) {
    const sprite = makeLabelSprite(label, color);
    sprite.position.set(x, y, z);
    scene.add(sprite);
  }
}

function sampleTerrainHeight(terrain: ProcgenHeightData, worldX: number, worldY: number): number {
  const x = Math.max(0, Math.min(terrain.resolution - 1, Math.round((worldX / terrain.worldSize) * (terrain.resolution - 1))));
  const z = Math.max(0, Math.min(terrain.resolution - 1, Math.round((worldY / terrain.worldSize) * (terrain.resolution - 1))));
  return terrain.heights[z * terrain.resolution + x] ?? SEA_LEVEL;
}

function addMapMarkers3D(
  parent: THREE.Object3D,
  terrain: ProcgenHeightData,
  team: MapTeamMember[],
  markers: MapMarkerPoint[],
  monuments: MapMonument[],
  layers: MapLayers,
): SelectableObject[] {
  const objects: SelectableObject[] = [];
  const add = (
    worldX: number,
    worldY: number,
    label: string,
    color: string,
    selection: MarkerSelection,
    yOffset = 95,
  ) => {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return;
    const sprite = makeMapMarkerSprite(label, color) as SelectableObject;
    sprite.position.set(
      worldToSceneX(worldX, terrain.worldSize),
      sampleTerrainHeight(terrain, worldX, worldY) + yOffset,
      worldToSceneZ(worldY, terrain.worldSize),
    );
    sprite.userData.worldX = worldX;
    sprite.userData.worldY = worldY;
    sprite.userData.markerSelection = selection;
    parent.add(sprite);
    objects.push(sprite);
  };

  if (layers.monuments) {
    for (const monument of monuments) {
      add(monument.x, monument.y, monument.name, "#facc15", { kind: "monument", token: monument.token }, 110);
    }
  }
  if (layers.team) {
    for (const member of team) {
      if (member.locationKnown === false || member.x == null || member.y == null) continue;
      add(
        member.x,
        member.y,
        member.name,
        member.isOnline ? "#22c55e" : "#94a3b8",
        { kind: "team", steamId: member.steamId },
        125,
      );
    }
  }
  for (const marker of markers) {
    if (marker.type === 3) {
      if (layers.vending) {
        add(marker.x, marker.y, marker.name || "Vending", "#38bdf8", { kind: "vending", markerId: marker.id }, 100);
      }
    } else if (isMapEventMarkerVisible(marker, layers)) {
      add(
        marker.x,
        marker.y,
        marker.name || marker.label || "Event",
        "#fb7185",
        { kind: "event", markerId: marker.id },
        120,
      );
    }
  }
  return objects;
}

function worldPoint3D(terrain: ProcgenHeightData, worldX: number, worldY: number, yOffset = 3): THREE.Vector3 {
  return new THREE.Vector3(
    worldToSceneX(worldX, terrain.worldSize),
    sampleTerrainHeight(terrain, worldX, worldY) + yOffset,
    worldToSceneZ(worldY, terrain.worldSize),
  );
}

function procgenPathUsesCenteredCoords(paths: ProcgenPath[]): boolean {
  let minCoord = 0;
  for (const path of paths) {
    for (const node of path.nodes) {
      minCoord = Math.min(minCoord, node.x, node.z);
    }
  }
  return minCoord < 0;
}

function procgenCoordToWorld(coord: number, worldSize: number, centered = true): number {
  return centered ? coord + worldSize / 2 : coord;
}

function addMapGrid3D(parent: THREE.Object3D, terrain: ProcgenHeightData, visible: boolean): Array<THREE.Line | THREE.Sprite> {
  if (!visible) return [];
  const objects: Array<THREE.Line | THREE.Sprite> = [];
  const cells = gridCellCount(terrain.worldSize);
  const material = new THREE.LineBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.45, depthTest: false });

  for (let i = 0; i <= cells; i++) {
    const coord = Math.min(i * MAP_GRID_CELL_SIZE, terrain.worldSize);
    for (const points of [
      [worldPoint3D(terrain, 0, coord, 6), worldPoint3D(terrain, terrain.worldSize, coord, 6)],
      [worldPoint3D(terrain, coord, 0, 6), worldPoint3D(terrain, coord, terrain.worldSize, 6)],
    ] as const) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([...points]), material);
      line.renderOrder = 35;
      parent.add(line);
      objects.push(line);
    }
  }

  for (let col = 0; col < cells; col++) {
    const sprite = makeLabelSprite(gridColumnLabel(col), "#e2e8f0");
    sprite.scale.set(90, 90, 1);
    sprite.position.copy(worldPoint3D(terrain, col * MAP_GRID_CELL_SIZE + MAP_GRID_CELL_SIZE * 0.5, terrain.worldSize - MAP_GRID_CELL_SIZE * 0.5, 85));
    parent.add(sprite);
    objects.push(sprite);
  }
  for (let row = 0; row < cells; row++) {
    const sprite = makeLabelSprite(String(row), "#e2e8f0");
    sprite.scale.set(90, 90, 1);
    sprite.position.copy(worldPoint3D(terrain, MAP_GRID_CELL_SIZE * 0.5, row * MAP_GRID_CELL_SIZE + MAP_GRID_CELL_SIZE * 0.5, 85));
    parent.add(sprite);
    objects.push(sprite);
  }

  return objects;
}

function addDrawings3D(
  parent: THREE.Object3D,
  terrain: ProcgenHeightData,
  drawings: MapDrawingStroke[],
  visible: boolean,
): SelectableObject[] {
  if (!visible) return [];
  const objects: SelectableObject[] = [];
  for (const drawing of drawings) {
    if (drawing.points.length < 2) continue;
    const points = drawing.points.map((p) => worldPoint3D(terrain, p.x, p.y, 8));
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(drawing.color),
      transparent: true,
      opacity: 1,
      depthTest: false,
    });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material) as SelectableObject;
    line.renderOrder = 40;
    line.userData.selection = { kind: "drawing", drawingId: drawing.id };
    parent.add(line);
    objects.push(line);

    if (drawing.label) {
      const mid = drawing.points[Math.floor(drawing.points.length / 2)] ?? drawing.points[0]!;
      const sprite = makeMapMarkerSprite(drawing.label, drawing.color) as SelectableObject;
      sprite.scale.set(180, 90, 1);
      sprite.position.copy(worldPoint3D(terrain, mid.x, mid.y, 75));
      sprite.userData.selection = { kind: "drawing", drawingId: drawing.id };
      parent.add(sprite);
      objects.push(sprite);
    }
  }
  return objects;
}

function addPins3D(parent: THREE.Object3D, terrain: ProcgenHeightData, pins: MapPin[], visible: boolean): SelectableObject[] {
  if (!visible) return [];
  const objects: SelectableObject[] = [];
  for (const pin of pins) {
    const sprite = makeMapMarkerSprite(pin.label, "#eab308") as SelectableObject;
    sprite.position.copy(worldPoint3D(terrain, pin.x, pin.y, 105));
    sprite.userData.selection = { kind: "pin", pinId: pin.id };
    parent.add(sprite);
    objects.push(sprite);
  }
  return objects;
}

function addAutomationBase3D(
  parent: THREE.Object3D,
  terrain: ProcgenHeightData,
  base: ResolvedAutomationBase,
): Array<THREE.Line | THREE.Mesh | THREE.Sprite> {
  const objects: Array<THREE.Line | THREE.Mesh | THREE.Sprite> = [];
  const radius = base.radiusMeters;
  const center = worldPoint3D(terrain, base.x, base.y, 8);

  if (radius > 0) {
    const segments = 72;
    const ringPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      ringPoints.push(
        worldPoint3D(
          terrain,
          base.x + Math.cos(angle) * radius,
          base.y + Math.sin(angle) * radius,
          12,
        ),
      );
    }
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ringPoints),
      new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    );
    ring.renderOrder = 36;
    parent.add(ring);
    objects.push(ring);

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 64),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(center.x, center.y + 2, center.z);
    disc.renderOrder = 34;
    parent.add(disc);
    objects.push(disc);
  }

  const sprite = makeMapMarkerSprite(base.label, "#38bdf8");
  sprite.scale.set(200, 100, 1);
  sprite.position.set(center.x, center.y + 95, center.z);
  parent.add(sprite);
  objects.push(sprite);

  return objects;
}

function addEventTrails3D(
  parent: THREE.Object3D,
  terrain: ProcgenHeightData,
  eventTrails: Map3DViewProps["eventTrails"],
  layers: MapLayers,
): Array<THREE.Line> {
  if (!eventTrails || !layers.events) return [];
  const lines: Array<THREE.Line> = [];
  const addTrail = (points2d: Array<{ x: number; y: number }>, color: number) => {
    if (points2d.length < 2) return;
    const points = points2d.map((p) => worldPoint3D(terrain, p.x, p.y, 12));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }),
    );
    line.renderOrder = 38;
    parent.add(line);
    lines.push(line);
  };
  if (layers.eventTypes.cargo) addTrail(eventTrails.cargo, 0x38bdf8);
  if (layers.eventTypes.heli) addTrail(eventTrails.heli, 0xfb7185);
  return lines;
}

async function loadAuthenticatedTexture(
  path: string,
  onLoaded: (texture: THREE.Texture) => void,
): Promise<void> {
  const blob = await fetchAuthenticatedBlob(path);
  if (!blob) return;

  const url = URL.createObjectURL(blob);
  new THREE.TextureLoader().load(
    url,
    (texture) => {
      URL.revokeObjectURL(url);
      onLoaded(texture);
    },
    undefined,
    () => URL.revokeObjectURL(url),
  );
}

function addProcgenTerrainOverlays3D(
  scene: THREE.Scene,
  terrainGeo: THREE.BufferGeometry,
  terrain: ProcgenHeightData,
  layers: MapProcgenLayers,
  onTextureReady?: () => void,
): { geometry: THREE.BufferGeometry | null; materials: Array<THREE.MeshBasicMaterial> } {
  const materials: Array<THREE.MeshBasicMaterial> = [];
  if (!PROCGEN_OVERLAYS.some((overlay) => layers[overlay.layer])) {
    return { geometry: null, materials };
  }

  const overlayGeo = terrainGeo.clone();
  const uvs = new Float32Array(terrain.resolution * terrain.resolution * 2);
  for (let z = 0; z < terrain.resolution; z++) {
    for (let x = 0; x < terrain.resolution; x++) {
      const idx = z * terrain.resolution + x;
      // Procgen PNG rows are opposite the 3D terrain's north/south texture direction.
      uvs[idx * 2] = x / (terrain.resolution - 1);
      uvs[idx * 2 + 1] = 1 - z / (terrain.resolution - 1);
    }
  }
  overlayGeo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));

  let offsetFactor = -1;

  for (const overlay of PROCGEN_OVERLAYS) {
    if (!layers[overlay.layer]) continue;
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: offsetFactor,
      side: THREE.DoubleSide,
    });
    void loadAuthenticatedTexture(`/servers/active/map/procgen/overlays/${overlay.id}`, (loaded) => {
      boostTextureAlpha(loaded, overlay.layer === "buildingBlocked" ? 1.6 : 3.2);
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.wrapS = THREE.ClampToEdgeWrapping;
      loaded.wrapT = THREE.ClampToEdgeWrapping;
      material.map = loaded;
      material.opacity = overlay.opacity;
      material.needsUpdate = true;
      onTextureReady?.();
    });
    const mesh = new THREE.Mesh(overlayGeo, material);
    mesh.renderOrder = 20 + materials.length;
    scene.add(mesh);
    materials.push(material);
    offsetFactor -= 1;
  }

  return { geometry: overlayGeo, materials };
}

function pathColor3D(name: string): number {
  const lower = name.toLowerCase();
  if (lower.includes("rail")) return 0x94a3b8;
  if (lower.includes("river")) return 0x38bdf8;
  if (lower.includes("road")) return 0xfbbf24;
  return 0xa78bfa;
}

function addProcgenPaths3D(
  parent: THREE.Object3D,
  terrain: ProcgenHeightData,
  paths: ProcgenPath[],
  visible: boolean,
): Array<THREE.Line> {
  if (!visible) return [];
  const lines: Array<THREE.Line> = [];
  const centered = procgenPathUsesCenteredCoords(paths);
  for (const path of paths) {
    if (path.nodes.length < 2) continue;
    const points = path.nodes.map(
      (node) => {
        const worldX = procgenCoordToWorld(node.x, terrain.worldSize, centered);
        const worldZ = procgenCoordToWorld(node.z, terrain.worldSize, centered);
        return new THREE.Vector3(
          worldToSceneX(worldX, terrain.worldSize),
          sampleTerrainHeight(terrain, worldX, worldZ) + 6,
          worldToSceneZ(worldZ, terrain.worldSize),
        );
      },
    );
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: pathColor3D(path.name),
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    material.linewidth = Math.max(1, path.width * 0.04);
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 30;
    parent.add(line);
    lines.push(line);
  }
  return lines;
}

function addProcgenPrefabs3D(
  parent: THREE.Object3D,
  terrain: ProcgenHeightData,
  prefabs: ProcgenPrefabPoint[],
  layers: MapProcgenLayers,
): THREE.Sprite[] {
  const sprites: THREE.Sprite[] = [];
  for (const prefab of prefabs) {
    if (prefab.kind === "cave" && !layers.caves) continue;
    if (prefab.kind === "iceberg" && !layers.icebergs) continue;
    if (prefab.kind !== "cave" && prefab.kind !== "iceberg") continue;

    const color = prefab.kind === "iceberg" ? "#7dd3fc" : "#c084fc";
    const sprite = makeMapMarkerSprite(prefab.label, color);
    const worldX = procgenCoordToWorld(prefab.x, terrain.worldSize);
    const worldZ = procgenCoordToWorld(prefab.z, terrain.worldSize);
    sprite.position.set(
      worldToSceneX(worldX, terrain.worldSize),
      sampleTerrainHeight(terrain, worldX, worldZ) + 115,
      worldToSceneZ(worldZ, terrain.worldSize),
    );
    parent.add(sprite);
    sprites.push(sprite);
  }
  return sprites;
}

export function Map3DView({
  worldSize,
  mapImageSrc,
  transform,
  team,
  markers,
  monuments,
  layers,
  drawings,
  pins,
  showTeamOverlays,
  procgenLayers,
  procgenPaths,
  procgenPrefabs,
  eventTrails,
  automationBase = null,
  selection = null,
  focusTarget = null,
  trackTarget = null,
  onUserPan,
  onSelect,
}: Map3DViewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [heightData, setHeightData] = useState<ProcgenHeightData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const cameraPersistRef = useRef<CameraPersist | null>(null);
  const cameraApiRef = useRef<CameraApi | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onUserPanRef = useRef(onUserPan);
  onUserPanRef.current = onUserPan;
  const trackTargetRef = useRef(trackTarget);
  trackTargetRef.current = trackTarget;
  const selectionLookupRef = useRef<MapSelectionLookup>({
    markers: [],
    monuments: [],
    team: [],
    pins: [],
    drawings: [],
  });
  selectionLookupRef.current = { markers, monuments, team, pins, drawings };
  const lastFocusKeyRef = useRef("");
  const [sceneReady, setSceneReady] = useState(0);
  const runtimeRef = useRef<Map3DRuntime | null>(null);

  useEffect(() => {
    void apiFetch<ProcgenHeightData>("/servers/active/map/procgen/height")
      .then(setHeightData)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Height data unavailable"));
  }, []);

  useEffect(() => {
    if (!selection && !focusTarget) {
      lastFocusKeyRef.current = "";
    }
  }, [selection, focusTarget]);

  useEffect(() => {
    if (!heightData || !cameraApiRef.current) return;

    const key = focusTarget
      ? `f:${focusTarget.nonce}`
      : selection
        ? `s:${JSON.stringify(selection)}`
        : "";
    if (!key || key === lastFocusKeyRef.current) return;
    lastFocusKeyRef.current = key;

    const coords = focusTarget
      ? { worldX: focusTarget.worldX, worldY: focusTarget.worldY }
      : selection
        ? worldCoordsForSelection(selection, selectionLookupRef.current)
        : null;
    if (!coords) return;

    cameraApiRef.current.focusWorld(coords.worldX, coords.worldY);
  }, [focusTarget, selection, heightData, sceneReady]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !heightData) return;

    const centerY = (heightData.minHeight + heightData.maxHeight) / 2;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, worldSize * 0.5, worldSize * 2.2);

    const dynamicGroup = new THREE.Group();
    scene.add(dynamicGroup);

    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 1, worldSize * 6);
    const persisted = cameraPersistRef.current;
    const target = new THREE.Vector3(
      persisted?.targetX ?? 0,
      persisted?.targetY ?? centerY,
      persisted?.targetZ ?? 0,
    );

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    const maxPixelRatio = Math.min(window.devicePixelRatio, 1.5);
    renderer.setPixelRatio(maxPixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    let needsRender = true;
    const requestRender = () => {
      needsRender = true;
    };

    const sun = new THREE.DirectionalLight(0xfff4e6, 1.35);
    sun.position.set(worldSize * 0.6, worldSize * 0.8, worldSize * 0.35);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x4a6741, 0.55));

    const texture = mapImageSrc
      ? new THREE.TextureLoader().load(mapImageSrc, () => requestRender())
      : null;
    if (texture) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
    }

    const terrainGeo = buildTerrainGeometry(heightData, transform);
    const terrainMaterial = texture
      ? new THREE.MeshLambertMaterial({ map: texture })
      : new THREE.MeshLambertMaterial({ vertexColors: true });
    const terrain = new THREE.Mesh(terrainGeo, terrainMaterial);
    scene.add(terrain);

    const waterGeo = SHOW_WATER ? buildWaterGeometry(heightData) : null;
    const water = waterGeo
      ? new THREE.Mesh(
        waterGeo,
        new THREE.MeshLambertMaterial({
          color: 0x1e4d78,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
        }),
      )
      : null;
    if (water) scene.add(water);

    addCardinalLabels(scene, worldSize, heightData.maxHeight + 120);
    const procgenOverlays = addProcgenTerrainOverlays3D(
      scene,
      terrainGeo,
      heightData,
      procgenLayers,
      requestRender,
    );

    let dragMode: "orbit" | "pan" | null = null;
    let lastX = 0;
    let lastY = 0;
    let pointerMoved = false;
    let theta = persisted?.theta ?? -Math.PI * 0.5;
    let phi = persisted?.phi ?? Math.PI * 0.32;
    let radius = persisted?.radius ?? worldSize * 0.85;
    type FocusAnim = {
      fromTarget: THREE.Vector3;
      toTarget: THREE.Vector3;
      fromRadius: number;
      toRadius: number;
      start: number;
      duration: number;
    };
    let focusAnim: FocusAnim | null = null;
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 18 };
    const pointer = new THREE.Vector2();
    const panRight = new THREE.Vector3();
    const panForward = new THREE.Vector3();

    const saveCamera = () => {
      cameraPersistRef.current = {
        theta,
        phi,
        radius,
        targetX: target.x,
        targetY: target.y,
        targetZ: target.z,
      };
    };

    const updateCamera = () => {
      camera.position.x = target.x + radius * Math.sin(phi) * Math.cos(theta);
      camera.position.y = target.y + radius * Math.cos(phi);
      camera.position.z = target.z + radius * Math.sin(phi) * Math.sin(theta);
      camera.lookAt(target);
    };
    updateCamera();
    saveCamera();

    runtimeRef.current = {
      dynamicGroup,
      selectableObjects: [],
      clusterCtx: { team: [], markers: [], monuments: [], layers },
      requestRender,
    };

    cameraApiRef.current = {
      focusWorld: (worldX: number, worldY: number) => {
        const sceneX = worldToSceneX(worldX, worldSize);
        const sceneZ = worldToSceneZ(worldY, worldSize);
        const terrainY = sampleTerrainHeight(heightData, worldX, worldY) + 80;
        const toTarget = new THREE.Vector3(sceneX, terrainY, sceneZ);
        const zoomRadius = Math.max(worldSize * 0.06, Math.min(radius, worldSize * 0.28));
        focusAnim = {
          fromTarget: target.clone(),
          toTarget,
          fromRadius: radius,
          toRadius: zoomRadius,
          start: performance.now(),
          duration: 420,
        };
        requestRender();
      },
    };
    setSceneReady((v) => v + 1);

    const setPointerFromEvent = (e: MouseEvent | PointerEvent | WheelEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    };

    const terrainHitFromEvent = (e: MouseEvent | PointerEvent | WheelEvent): THREE.Vector3 | null => {
      setPointerFromEvent(e);
      const hits = raycaster.intersectObject(terrain, false);
      return hits[0]?.point?.clone() ?? null;
    };

    const clampTarget = () => {
      const half = worldSize / 2;
      target.x = Math.max(-half, Math.min(half, target.x));
      target.z = Math.max(-half, Math.min(half, target.z));
    };

    const panCamera = (dx: number, dy: number) => {
      const panSpeed = radius * 0.002;
      panRight.setFromMatrixColumn(camera.matrix, 0);
      panRight.y = 0;
      if (panRight.lengthSq() > 0) panRight.normalize();
      panForward.setFromMatrixColumn(camera.matrix, 2);
      panForward.y = 0;
      if (panForward.lengthSq() > 0) panForward.normalize();
      target.addScaledVector(panRight, -dx * panSpeed);
      target.addScaledVector(panForward, -dy * panSpeed);
      clampTarget();
    };

    const onPointerDown = (e: PointerEvent) => {
      focusAnim = null;
      dragMode = e.button === 1 || e.button === 2 || e.shiftKey ? "pan" : "orbit";
      lastX = e.clientX;
      lastY = e.clientY;
      pointerMoved = false;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragMode) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (Math.hypot(dx, dy) > 3) {
        if (!pointerMoved) onUserPanRef.current?.();
        pointerMoved = true;
      }
      lastX = e.clientX;
      lastY = e.clientY;

      if (dragMode === "pan") {
        panCamera(dx, dy);
      } else {
        theta -= dx * 0.005;
        phi = Math.max(0.12, Math.min(Math.PI / 2 - 0.04, phi + dy * 0.005));
      }
      updateCamera();
      requestRender();
    };
    const onPointerUp = (e: PointerEvent) => {
      dragMode = null;
      saveCamera();
      renderer.domElement.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const focus = terrainHitFromEvent(e);
      const zoomFactor = Math.exp(e.deltaY * 0.0016);
      radius = Math.max(worldSize * 0.06, Math.min(worldSize * 1.8, radius * zoomFactor));
      if (focus && zoomFactor < 1) {
        target.lerp(focus, Math.min(0.45, 1 - zoomFactor));
        clampTarget();
      }
      updateCamera();
      saveCamera();
      requestRender();
    };

    const onClick = (e: MouseEvent) => {
      if (pointerMoved || !onSelectRef.current) return;
      const runtime = runtimeRef.current;
      if (!runtime) return;
      setPointerFromEvent(e);
      const hits = raycaster.intersectObjects(runtime.selectableObjects, false);
      const picked = pickSelectionFromHits(hits, runtime.clusterCtx);
      if (picked) onSelectRef.current(picked);
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("click", onClick);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    let frameId = 0;
    const trackScenePoint = (worldX: number, worldY: number) =>
      new THREE.Vector3(
        worldToSceneX(worldX, worldSize),
        sampleTerrainHeight(heightData, worldX, worldY) + 80,
        worldToSceneZ(worldY, worldSize),
      );

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      let cameraDirty = false;
      if (focusAnim) {
        const t = Math.min(1, (performance.now() - focusAnim.start) / focusAnim.duration);
        const ease = 1 - (1 - t) ** 3;
        target.lerpVectors(focusAnim.fromTarget, focusAnim.toTarget, ease);
        radius = focusAnim.fromRadius + (focusAnim.toRadius - focusAnim.fromRadius) * ease;
        clampTarget();
        if (t >= 1) {
          focusAnim = null;
          saveCamera();
        }
        cameraDirty = true;
      } else {
        const tracked = trackTargetRef.current;
        if (tracked) {
          const desired = trackScenePoint(tracked.worldX, tracked.worldY);
          if (target.distanceToSquared(desired) > 4) {
            target.lerp(desired, 0.12);
            clampTarget();
            cameraDirty = true;
          }
        }
      }
      if (cameraDirty) updateCamera();
      if (!needsRender && !cameraDirty) return;
      needsRender = false;
      renderer.render(scene, camera);
    };
    animate();
    requestRender();

    const onResize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      requestRender();
    };
    window.addEventListener("resize", onResize);

    return () => {
      saveCamera();
      cameraApiRef.current = null;
      runtimeRef.current = null;
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      clearGroup(dynamicGroup);
      terrainGeo.dispose();
      terrainMaterial.dispose();
      waterGeo?.dispose();
      if (water) (water.material as THREE.Material).dispose();
      procgenOverlays.geometry?.dispose();
      for (const material of procgenOverlays.materials) {
        material.map?.dispose();
        material.dispose();
      }
      texture?.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [heightData, worldSize, mapImageSrc, transform, procgenLayers]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !heightData) return;

    clearGroup(runtime.dynamicGroup);

    addMapGrid3D(runtime.dynamicGroup, heightData, layers.grid);
    if (layers.base && automationBase) {
      addAutomationBase3D(runtime.dynamicGroup, heightData, automationBase);
    }
    addProcgenPaths3D(runtime.dynamicGroup, heightData, procgenPaths, procgenLayers.paths);
    addProcgenPrefabs3D(runtime.dynamicGroup, heightData, procgenPrefabs, procgenLayers);
    addEventTrails3D(runtime.dynamicGroup, heightData, eventTrails, layers);
    const drawingObjects = addDrawings3D(runtime.dynamicGroup, heightData, drawings, showTeamOverlays);
    const pinObjects = addPins3D(runtime.dynamicGroup, heightData, pins, showTeamOverlays);
    const markerObjects = addMapMarkers3D(
      runtime.dynamicGroup,
      heightData,
      team,
      markers,
      monuments,
      layers,
    );

    runtime.selectableObjects = [...markerObjects, ...drawingObjects, ...pinObjects];
    runtime.clusterCtx = {
      team: team.filter((m) => m.locationKnown !== false && m.x != null && m.y != null),
      markers,
      monuments,
      layers,
    };
    runtime.requestRender();
  }, [
    heightData,
    team,
    markers,
    monuments,
    layers,
    automationBase,
    drawings,
    pins,
    showTeamOverlays,
    procgenLayers.paths,
    procgenLayers.caves,
    procgenLayers.icebergs,
    procgenPaths,
    procgenPrefabs,
    eventTrails,
  ]);

  if (loadError) {
    return <p className="muted map-3d-error">{loadError}. Upload a .map file in Settings first.</p>;
  }

  if (!heightData) {
    return <p className="muted">Loading 3D terrain…</p>;
  }

  if (!heightData.colors?.length) {
    return (
      <p className="muted map-3d-error">
        Terrain data is outdated. Re-upload your .map file in Settings to refresh the 3D view.
      </p>
    );
  }

  return (
    <div className="map-3d-panel map-viewport-wrap">
      <div className="map-viewport-toolbar map-3d-toolbar">
        <span className="muted">
          Drag to orbit · Shift/right-drag to pan · Scroll to zoom toward cursor
          {" · "}
          Click markers to inspect and zoom in
          {" · "}
          Elevation {Math.round(heightData.minHeight)}m – {Math.round(heightData.maxHeight)}m
        </span>
      </div>
      <div ref={mountRef} className="map-3d-canvas map-viewport" />
    </div>
  );
}
