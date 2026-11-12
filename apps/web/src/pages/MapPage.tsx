import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  AutomationBaseSettings,
  MapCoordinateTransform,
  MapDrawingPoint,
  MapDrawingStroke,
  MapOverlaysResponse,
  MapPin,
} from "@rusttools/shared";
import { MAP_DRAWING_COLORS, formatProximityRadiusMeters, proximityRadiusPatch, resolveAutomationBaseCoords, resolveProximityRadiusMeters } from "@rusttools/shared";
import { DEFAULT_PROCGEN_LAYERS, type MapProcgenLayers, type ProcgenMapStatus, type ProcgenPath, type ProcgenPrefabPoint } from "@rusttools/shared";
import { MapAutomationBaseOverlay } from "../components/MapAutomationBaseOverlay";
import { MapGridOverlay } from "../components/MapGridOverlay";
import { MapDetailPanel, type MapSelection } from "../components/MapDetailPanel";
import type { MapLayers, MapMonument, MapTeamMember } from "../components/MapOverlay";
import { MapOverlay } from "../components/MapOverlay";
import { MapLayersPanel } from "../components/MapLayersPanel";
import { MapViewport, type MapFocusTarget } from "../components/MapViewport";
import { MapDrawingLayer, type MapAnnotateTool } from "../components/MapDrawingLayer";
import { MapProcgenOverlays } from "../components/MapProcgenOverlays";
import { MapPathsOverlay } from "../components/MapPathsOverlay";
import { MapPrefabOverlay } from "../components/MapPrefabOverlay";
import { Map3DView } from "../components/Map3DView";
import { useWebSocket } from "../hooks/WebSocketProvider";
import { useCan } from "../hooks/usePermissions";
import { useActiveServer } from "../hooks/useActiveServer";
import { apiFetch } from "../lib/api";
import { peekApiCache } from "../lib/api-cache";
import { LastUpdatedLine } from "../components/LastUpdatedLine";
import { demoMapSize, demoMonuments, demoTeam, demoMapTransform, isDemoMode } from "../lib/demo";

interface MapData {
  map: { width?: number; height?: number; imageBase64: string | null };
  transform: MapCoordinateTransform;
  team: MapTeamMember[];
  monuments: MapMonument[];
}

const DEFAULT_LAYERS: MapLayers = {
  team: true,
  monuments: true,
  grid: true,
  base: true,
};

const MAP_DATA_PATH = "/servers/active/map?includeImage=1";
const MAP_OVERLAYS_PATH = "/servers/active/map/overlays";

export function MapPage() {
  const canSwitch = useCan("switch");
  const canAdmin = useCan("admin");
  const { epoch } = useActiveServer();
  const [searchParams, setSearchParams] = useSearchParams();
  const memberParam = searchParams.get("member");
  const [mapImage, setMapImage] = useState<MapData["map"] | null>(null);
  const [team, setTeam] = useState<MapTeamMember[]>([]);
  const [monuments, setMonuments] = useState<MapMonument[]>([]);
  const [transform, setTransform] = useState<MapCoordinateTransform | null>(
    isDemoMode() ? demoMapTransform : null,
  );
  const [layers, setLayers] = useState<MapLayers>(DEFAULT_LAYERS);
  const [procgenLayers, setProcgenLayers] = useState<MapProcgenLayers>(DEFAULT_PROCGEN_LAYERS);
  const [procgenStatus, setProcgenStatus] = useState<ProcgenMapStatus | null>(null);
  const [procgenPaths, setProcgenPaths] = useState<ProcgenPath[]>([]);
  const [procgenPrefabs, setProcgenPrefabs] = useState<ProcgenPrefabPoint[]>([]);
  const [mapViewMode, setMapViewMode] = useState<"2d" | "3d">("2d");
  const [showTeamOverlays, setShowTeamOverlays] = useState(true);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [annotateTool, setAnnotateTool] = useState<MapAnnotateTool>("pen");
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [focusTarget, setFocusTarget] = useState<MapFocusTarget | null>(null);
  const mapLayoutRef = useRef<HTMLDivElement>(null);
  const lastMemberFocusRef = useRef<string | null>(null);
  const [drawings, setDrawings] = useState<MapDrawingStroke[]>([]);
  const [pins, setPins] = useState<MapPin[]>([]);
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(null);
  const [pendingDrawing, setPendingDrawing] = useState<{ points: MapDrawingPoint[] } | null>(null);
  const [drawColor, setDrawColor] = useState<string>(MAP_DRAWING_COLORS[0].value);
  const [pendingDrawingColor, setPendingDrawingColor] = useState<string>(MAP_DRAWING_COLORS[0].value);
  const [followSteamId, setFollowSteamId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dataFetchedAt, setDataFetchedAt] = useState<number | null>(null);
  const [automationBase, setAutomationBase] = useState<AutomationBaseSettings | null>(null);
  const [setBaseMode, setSetBaseMode] = useState(() => searchParams.get("setBase") === "1");
  const [pendingBasePoint, setPendingBasePoint] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    void apiFetch<{ automationBase: AutomationBaseSettings }>("/automation-settings")
      .then((res) => setAutomationBase(res.automationBase))
      .catch(() => setAutomationBase(null));
  }, [epoch]);

  const saveAutomationBase = useCallback(async (patch: Partial<AutomationBaseSettings>) => {
    try {
      const res = await apiFetch<{ automationBase: AutomationBaseSettings }>("/automation-settings", {
        method: "PATCH",
        body: JSON.stringify({ automationBase: patch }),
      });
      setAutomationBase(res.automationBase);
      setLayers((prev) => ({ ...prev, base: true }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save server base");
    }
  }, []);

  const exitSetBaseMode = useCallback(() => {
    setSetBaseMode(false);
    setPendingBasePoint(null);
    setSelection((sel) => (sel?.kind === "pendingBase" ? null : sel));
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("setBase");
      return next;
    });
  }, [setSearchParams]);

  const enterSetBaseMode = useCallback(() => {
    setSetBaseMode(true);
    setAnnotateMode(false);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("setBase", "1");
      return next;
    });
  }, [setSearchParams]);

  const setServerBaseFromPin = useCallback(
    (pin: MapPin) => {
      void saveAutomationBase({
        mapPinId: pin.id,
        label: pin.label,
        x: pin.x,
        y: pin.y,
      }).then(() => exitSetBaseMode());
    },
    [saveAutomationBase, exitSetBaseMode],
  );

  const confirmPendingBase = useCallback(
    (label: string, radiusMeters: number) => {
      if (!pendingBasePoint) return;
      void saveAutomationBase({
        x: pendingBasePoint.x,
        y: pendingBasePoint.y,
        mapPinId: null,
        label,
        ...proximityRadiusPatch(radiusMeters),
      }).then(() => exitSetBaseMode());
    },
    [pendingBasePoint, saveAutomationBase, exitSetBaseMode],
  );

  const refreshLive = useCallback(async () => {
    if (isDemoMode()) {
      setTeam(demoTeam);
      setDataFetchedAt(Date.now());
      return;
    }

    const live = await apiFetch<{ team: { members: MapTeamMember[] } }>("/servers/active/team");
    setTeam(live.team.members);
    setDataFetchedAt(Date.now());
  }, []);

  const mapImageSrc = useMemo(() => {
    const base64 = mapImage?.imageBase64;
    if (!base64) return null;
    return `data:image/jpeg;base64,${base64}`;
  }, [mapImage?.imageBase64]);

  useEffect(() => {
    type MapPayload = Omit<MapData, "map"> & {
      map: { width: number; height: number; imageBase64: string | null };
    };

    const applyMapData = (
      data: MapPayload,
      overlays: MapOverlaysResponse,
      fetchedAt: number,
    ) => {
      setMapImage(data.map);
      setTransform(data.transform);
      setTeam(data.team);
      setMonuments(data.monuments);
      setDrawings(overlays.drawings);
      setPins(overlays.pins);
      setDataFetchedAt(fetchedAt);
      setError(null);
    };

    const cachedMap = peekApiCache<MapPayload>(MAP_DATA_PATH);
    const cachedOverlays = peekApiCache<MapOverlaysResponse>(MAP_OVERLAYS_PATH);
    if (cachedMap) {
      applyMapData(
        cachedMap.value,
        cachedOverlays?.value ?? { drawings: [], pins: [] },
        cachedMap.fetchedAt,
      );
      setLoading(false);
    } else {
      setLoading(true);
      setMapImage(null);
    }

    setSelection(null);
    setFocusTarget(null);
    setFollowSteamId(null);
    setRefreshing(true);

    Promise.all([
      apiFetch<MapPayload>(MAP_DATA_PATH),
      apiFetch<MapOverlaysResponse>(MAP_OVERLAYS_PATH).catch(() => ({
        drawings: [],
        pins: [],
      })),
    ])
      .then(([data, overlays]) => applyMapData(data, overlays, Date.now()))
      .catch((err: Error) => {
        if (!cachedMap) setError(err.message);
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [epoch]);

  const procgenReady = procgenStatus?.parseStatus === "ready";

  useEffect(() => {
    void apiFetch<ProcgenMapStatus>("/servers/active/map/procgen/status")
      .then(setProcgenStatus)
      .catch(() => setProcgenStatus(null));
  }, [epoch]);

  useEffect(() => {
    if (!procgenReady) {
      setProcgenPaths([]);
      setProcgenPrefabs([]);
      return;
    }
    void apiFetch<{ paths: ProcgenPath[] }>("/servers/active/map/procgen/paths")
      .then((res) => setProcgenPaths(res.paths))
      .catch(() => setProcgenPaths([]));
    void apiFetch<{ prefabs: ProcgenPrefabPoint[] }>("/servers/active/map/procgen/prefabs")
      .then((res) => setProcgenPrefabs(res.prefabs))
      .catch(() => setProcgenPrefabs([]));
  }, [procgenReady, epoch]);

  useWebSocket((event, payload) => {
    if (event === "teamChanged") {
      const p = payload as { team?: { members?: MapTeamMember[] } } | null;
      if (p?.team?.members) {
        setTeam(p.team.members);
        setDataFetchedAt(Date.now());
      }
    }
  });

  const toggleLayer = (key: keyof MapLayers) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleProcgenLayer = (key: keyof MapProcgenLayers) => {
    setProcgenLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const deleteDrawing = async (id: string) => {
    try {
      await apiFetch(`/servers/active/map/drawings/${id}`, { method: "DELETE" });
      setDrawings((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete drawing");
    }
  };

  const deletePin = async (id: string) => {
    try {
      await apiFetch(`/servers/active/map/pins/${id}`, { method: "DELETE" });
      setPins((prev) => prev.filter((p) => p.id !== id));
      if (selection?.kind === "pin" && selection.pinId === id) {
        setSelection(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete pin");
    }
  };

  const discardPendingPin = useCallback(() => {
    setPendingPin(null);
    setSelection((sel) => (sel?.kind === "pendingPin" ? null : sel));
  }, []);

  const discardPendingDrawing = useCallback(() => {
    setPendingDrawing(null);
    setSelection((sel) => (sel?.kind === "pendingDrawing" ? null : sel));
  }, []);

  const savePendingPin = useCallback(
    async (label: string, notes: string) => {
      if (!pendingPin) return;
      try {
        const pin = await apiFetch<MapPin>("/servers/active/map/pins", {
          method: "POST",
          body: JSON.stringify({ label, notes, x: pendingPin.x, y: pendingPin.y }),
        });
        setPins((prev) => [...prev, pin]);
        setPendingPin(null);
        setSelection({ kind: "pin", pinId: pin.id });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to place pin");
      }
    },
    [pendingPin],
  );

  const savePendingDrawing = useCallback(
    async (label: string, color: string) => {
      if (!pendingDrawing) return;
      try {
        const stroke = await apiFetch<MapDrawingStroke>("/servers/active/map/drawings", {
          method: "POST",
          body: JSON.stringify({
            tool: "pen",
            label,
            color,
            width: 3,
            points: pendingDrawing.points,
          }),
        });
        setDrawings((prev) => [...prev, stroke]);
        setPendingDrawing(null);
        setSelection({ kind: "drawing", drawingId: stroke.id });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save drawing");
      }
    },
    [pendingDrawing],
  );

  useEffect(() => {
    if (!annotateMode) {
      setPendingPin(null);
      setPendingDrawing(null);
      setSelection((sel) =>
        sel?.kind === "pendingPin" || sel?.kind === "pendingDrawing" ? null : sel,
      );
    }
  }, [annotateMode]);

  useEffect(() => {
    if (annotateTool !== "pin") {
      discardPendingPin();
    }
  }, [annotateTool, discardPendingPin]);

  useEffect(() => {
    if (annotateTool !== "pen") {
      discardPendingDrawing();
    }
  }, [annotateTool, discardPendingDrawing]);

  useEffect(() => {
    if (!setBaseMode) return;
    setAnnotateMode(false);
  }, [setBaseMode]);

  useEffect(() => {
    if (annotateMode) {
      setSetBaseMode(false);
      setPendingBasePoint(null);
      setSelection((sel) => (sel?.kind === "pendingBase" ? null : sel));
    }
  }, [annotateMode]);

  useEffect(() => {
    if (!canAdmin && setBaseMode) {
      exitSetBaseMode();
    }
  }, [canAdmin, setBaseMode, exitSetBaseMode]);

  const mapW = mapImage?.width ?? demoMapSize.width;
  const mapH = mapImage?.height ?? demoMapSize.height;
  const teamOnMap = team.length > 0 ? team : isDemoMode() ? demoTeam : [];
  const monumentList = monuments.length > 0 ? monuments : isDemoMode() ? demoMonuments : [];
  const showDemoMap = isDemoMode() && mapImage && !mapImage.imageBase64;
  const onlineCount = teamOnMap.filter((m) => m.isOnline).length;

  const mapTransform = transform ?? demoMapTransform;
  const worldSize = mapTransform.worldSize;
  const mapReady = Boolean(mapImage?.imageBase64 || showDemoMap);

  const resolvedAutomationBase = useMemo(() => {
    if (!automationBase) return null;
    return resolveAutomationBaseCoords(
      automationBase,
      pins.map((p) => ({ id: p.id, x: p.x, y: p.y, label: p.label })),
    );
  }, [automationBase, pins]);

  const setBaseToolbar =
    canAdmin && mapReady ? (
      <button
        type="button"
        className={`btn-secondary${setBaseMode ? " active" : ""}`}
        onClick={() => (setBaseMode ? exitSetBaseMode() : enterSetBaseMode())}
      >
        {setBaseMode ? "Cancel base" : "Set server base"}
      </button>
    ) : null;

  const annotateToolbar =
    canSwitch && mapReady ? (
      <>
        <button
          type="button"
          className={`btn-secondary${annotateMode ? " active" : ""}`}
          onClick={() => setAnnotateMode((v) => !v)}
        >
          {annotateMode ? "Done" : "Annotate"}
        </button>
        {annotateMode && (
          <>
            <button
              type="button"
              className={`btn-secondary${annotateTool === "pen" ? " active" : ""}`}
              onClick={() => setAnnotateTool("pen")}
            >
              Draw
            </button>
            <button
              type="button"
              className={`btn-secondary${annotateTool === "pin" ? " active" : ""}`}
              onClick={() => setAnnotateTool("pin")}
            >
              Pin
            </button>
            {annotateTool === "pen" && pendingDrawing == null && (
              <div className="map-annotate-colors" role="group" aria-label="Stroke color">
                {MAP_DRAWING_COLORS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`map-drawing-color-swatch${drawColor === option.value ? " active" : ""}`}
                    style={{ background: option.value }}
                    title={option.name}
                    aria-label={option.name}
                    aria-pressed={drawColor === option.value}
                    onClick={() => setDrawColor(option.value)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </>
    ) : null;

  const followMember = followSteamId
    ? teamOnMap.find((m) => m.steamId === followSteamId)
    : undefined;

  const trackTarget = useMemo(() => {
    if (followMember?.x != null && followMember?.y != null) {
      return { worldX: followMember.x, worldY: followMember.y };
    }
    return null;
  }, [followMember]);

  useEffect(() => {
    if (!memberParam) {
      lastMemberFocusRef.current = null;
      return;
    }
    if (!mapReady) return;

    const match = teamOnMap.find((m) => m.steamId === memberParam);
    if (!match || match.locationKnown === false || match.x == null || match.y == null) return;

    setLayers((prev) => ({ ...prev, team: true }));
    setSelection({ kind: "team", steamId: memberParam });

    if (lastMemberFocusRef.current === memberParam) return;
    lastMemberFocusRef.current = memberParam;

    setFocusTarget({ worldX: match.x, worldY: match.y, nonce: Date.now() });
    requestAnimationFrame(() => {
      mapLayoutRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [memberParam, mapReady, teamOnMap]);

  const mapContent =
    mapReady && mapTransform ? (
      <div className="map-layout" ref={mapLayoutRef}>
        <MapLayersPanel
          layers={layers}
          procgenLayers={procgenLayers}
          procgenReady={procgenReady}
          onlineCount={onlineCount}
          teamOnMapCount={teamOnMap.length}
          monumentCount={monumentList.length}
          showTeamOverlays={showTeamOverlays}
          drawings={drawings}
          pins={pins}
          canSwitch={canSwitch}
          onToggleLayer={toggleLayer}
          onToggleProcgenLayer={toggleProcgenLayer}
          onShowTeamOverlaysChange={setShowTeamOverlays}
          onRefresh={() => void refreshLive()}
          onDeletePin={deletePin}
          onDeleteDrawing={deleteDrawing}
          onSelectPin={(pinId) => setSelection({ kind: "pin", pinId })}
          onSelectDrawing={(drawingId) => setSelection({ kind: "drawing", drawingId })}
          resolvedAutomationBase={resolvedAutomationBase}
          onFocusAutomationBase={() => {
            if (!resolvedAutomationBase) return;
            setLayers((prev) => ({ ...prev, base: true }));
            setFocusTarget({
              worldX: resolvedAutomationBase.x,
              worldY: resolvedAutomationBase.y,
              nonce: Date.now(),
            });
          }}
          canEditAutomationBase={canAdmin}
          automationBaseRadiusMeters={resolveProximityRadiusMeters(automationBase ?? undefined)}
          onAutomationBaseRadiusChange={(meters) =>
            void saveAutomationBase(proximityRadiusPatch(meters))
          }
        />
        <div className="map-layout-main">
          {mapViewMode === "3d" && procgenReady ? (
            <Map3DView
              worldSize={worldSize}
              mapImageSrc={mapImageSrc}
              transform={mapTransform}
              team={teamOnMap}
              monuments={monumentList}
              layers={layers}
              drawings={drawings}
              pins={pins}
              showTeamOverlays={showTeamOverlays}
              procgenLayers={procgenLayers}
              procgenPaths={procgenPaths}
              procgenPrefabs={procgenPrefabs}
              automationBase={resolvedAutomationBase}
              selection={selection}
              focusTarget={focusTarget}
              trackTarget={trackTarget}
              onUserPan={() => {
                setFollowSteamId(null);
              }}
              onSelect={setSelection}
            />
          ) : (
          <MapViewport
            width={mapW}
            height={mapH}
            imageSrc={mapImageSrc}
            demo={Boolean(showDemoMap)}
            transform={mapTransform}
            focusTarget={focusTarget}
            trackTarget={trackTarget}
            disablePan={(annotateMode && canSwitch) || (setBaseMode && canAdmin)}
            toolbarExtra={
              <>
                {setBaseToolbar}
                {annotateToolbar}
              </>
            }
            onUserPan={() => {
              setFollowSteamId(null);
            }}
          >
            <MapProcgenOverlays
              width={mapW}
              height={mapH}
              transform={mapTransform}
              layers={procgenLayers}
              procgenReady={procgenReady}
            />
            {layers.grid && (
              <MapGridOverlay width={mapW} height={mapH} transform={mapTransform} />
            )}
            {layers.base && resolvedAutomationBase && (
              <MapAutomationBaseOverlay
                width={mapW}
                height={mapH}
                transform={mapTransform}
                base={resolvedAutomationBase}
              />
            )}
            <MapPathsOverlay
              width={mapW}
              height={mapH}
              transform={mapTransform}
              paths={procgenPaths}
              visible={procgenLayers.paths}
            />
            <MapPrefabOverlay
              width={mapW}
              height={mapH}
              transform={mapTransform}
              prefabs={procgenPrefabs}
              showCaves={procgenLayers.caves}
              showIcebergs={procgenLayers.icebergs}
            />
            <MapOverlay
              width={mapW}
              height={mapH}
              transform={mapTransform}
              team={teamOnMap}
              monuments={monumentList}
              layers={layers}
              selection={selection}
              onSelect={setSelection}
            />
            <MapDrawingLayer
              width={mapW}
              height={mapH}
              transform={mapTransform}
              drawings={drawings}
              pins={pins}
              visible={showTeamOverlays}
              editMode={annotateMode}
              canEdit={canSwitch}
              tool={annotateTool}
              hasPendingPin={pendingPin != null}
              hasPendingDrawing={pendingDrawing != null}
              pendingPin={pendingPin}
              pendingDrawing={pendingDrawing}
              drawColor={drawColor}
              pendingDrawingColor={pendingDrawingColor}
              onPendingPin={(point) => {
                setPendingPin({ x: point.x, y: point.y });
                setSelection({ kind: "pendingPin" });
              }}
              onPendingDrawing={(points) => {
                setPendingDrawing({ points });
                setPendingDrawingColor(drawColor);
                setSelection({ kind: "pendingDrawing" });
              }}
              onSelectPin={(pin) => setSelection({ kind: "pin", pinId: pin.id })}
              onSelectDrawing={(drawing) => setSelection({ kind: "drawing", drawingId: drawing.id })}
              basePickMode={setBaseMode && canAdmin}
              pendingBasePoint={pendingBasePoint}
              onBasePick={(point) => {
                setPendingBasePoint({ x: point.x, y: point.y });
                setSelection({ kind: "pendingBase" });
              }}
            />
          </MapViewport>
          )}
        </div>
        <MapDetailPanel
          selection={selection}
          monuments={monumentList}
          team={teamOnMap}
          pins={pins}
          drawings={drawings}
          worldSize={worldSize}
          onClose={() => {
            if (selection?.kind === "pendingPin") {
              discardPendingPin();
              return;
            }
            if (selection?.kind === "pendingDrawing") {
              discardPendingDrawing();
              return;
            }
            if (selection?.kind === "pendingBase") {
              exitSetBaseMode();
              return;
            }
            setSelection(null);
          }}
          onSelect={setSelection}
          onFollowTeam={(steamId) => {
            setFollowSteamId(steamId);
            setSelection({ kind: "team", steamId });
          }}
          followingSteamId={followSteamId}
          canEditPins={canSwitch}
          onPinUpdated={(pin) => setPins((prev) => prev.map((p) => (p.id === pin.id ? pin : p)))}
          onPinDeleted={deletePin}
          onDrawingUpdated={(drawing) =>
            setDrawings((prev) => prev.map((d) => (d.id === drawing.id ? drawing : d)))
          }
          onDrawingDeleted={deleteDrawing}
          pendingPin={pendingPin}
          pendingDrawing={pendingDrawing}
          pendingDrawingColor={pendingDrawingColor}
          onPendingDrawingColorChange={setPendingDrawingColor}
          onPendingPinSave={(label, notes) => void savePendingPin(label, notes)}
          onPendingPinDiscard={discardPendingPin}
          onPendingDrawingSave={(label, color) => void savePendingDrawing(label, color)}
          onPendingDrawingDiscard={discardPendingDrawing}
          canSetServerBase={canAdmin}
          serverBasePinId={automationBase?.mapPinId ?? null}
          onSetServerBaseFromPin={setServerBaseFromPin}
          pendingBasePoint={pendingBasePoint}
          serverBaseRadiusMeters={resolveProximityRadiusMeters(automationBase ?? undefined)}
          onConfirmPendingBase={(label, radiusMeters) => confirmPendingBase(label, radiusMeters)}
          onDiscardPendingBase={exitSetBaseMode}
        />
      </div>
    ) : loading ? (
      <p className="muted">Loading map from Rust+ server (this can take up to a minute)...</p>
    ) : error ? (
      <p className="muted">Could not load map: {error}</p>
    ) : (
      <p className="muted">Map image unavailable from the server.</p>
    );

  return (
    <div>
      <header className="page-header">
        <h1>Map</h1>
        <p>Live team positions, monuments, and team annotations.</p>
        <div className="map-view-mode-toggle">
          <button
            type="button"
            className={`btn-secondary${mapViewMode === "2d" ? " active" : ""}`}
            onClick={() => setMapViewMode("2d")}
          >
            2D map
          </button>
          <button
            type="button"
            className={`btn-secondary${mapViewMode === "3d" ? " active" : ""}`}
            disabled={!procgenReady}
            title={procgenReady ? undefined : "Upload a .map file in Settings to enable 3D view"}
            onClick={() => setMapViewMode("3d")}
          >
            3D terrain
          </button>
        </div>
        <LastUpdatedLine
          fetchedAt={dataFetchedAt}
          refreshing={refreshing}
          className="muted map-updated"
        />
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      {setBaseMode && canAdmin && (
        <div className="alert alert-info map-set-base-banner">
          Click the map to place the server automation base. The blue zone shows the current proximity radius
          {resolvedAutomationBase
            ? ` (${formatProximityRadiusMeters(resolvedAutomationBase.radiusMeters)})`
            : ""}.{" "}
          <Link to="/automations">Adjust radius in Automations</Link>.
        </div>
      )}

      {mapContent}
    </div>
  );
}
