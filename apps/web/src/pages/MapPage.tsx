import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  MapCoordinateTransform,
  MapDrawingPoint,
  MapDrawingStroke,
  MapOverlaysResponse,
  MapPin,
  VendingSearchResult,
  WorldEventsStatus,
} from "@rusttools/shared";
import { MAP_DRAWING_COLORS } from "@rusttools/shared";
import { DEFAULT_PROCGEN_LAYERS, type MapProcgenLayers, type ProcgenMapStatus, type ProcgenPath, type ProcgenPrefabPoint } from "@rusttools/shared";
import { MapGridOverlay } from "../components/MapGridOverlay";
import { MapDetailPanel, type MapSelection } from "../components/MapDetailPanel";
import type {
  MapEventTypeKey,
  MapLayers,
  MapMarkerPoint,
  MapMonument,
  MapTeamMember,
} from "../components/MapOverlay";
import {
  classifyMapEventMarker,
  DEFAULT_EVENT_TYPE_LAYERS,
  MapOverlay,
} from "../components/MapOverlay";
import { MapLayersPanel } from "../components/MapLayersPanel";
import { MapViewport, type MapFocusTarget } from "../components/MapViewport";
import { MapDrawingLayer, type MapAnnotateTool } from "../components/MapDrawingLayer";
import { MapProcgenOverlays } from "../components/MapProcgenOverlays";
import { MapPathsOverlay } from "../components/MapPathsOverlay";
import { MapPrefabOverlay } from "../components/MapPrefabOverlay";
import { Map3DView } from "../components/Map3DView";
import { VendingTradeRow } from "../components/VendingTradeRow";
import type { MapTrackableEvent } from "../components/MapEventDock";
import { useMapImageSrc } from "../hooks/useMapImageSrc";
import { useWebSocket } from "../hooks/useWebSocket";
import { useCan } from "../hooks/usePermissions";
import { useActiveServer } from "../hooks/useActiveServer";
import { apiFetch } from "../lib/api";
import { demoMapMarkers, demoMapSize, demoMonuments, demoTeam, demoMapTransform, isDemoMode } from "../lib/demo";

interface MapData {
  map: { width?: number; height?: number; imageBase64: string | null };
  transform: MapCoordinateTransform;
  team: MapTeamMember[];
  monuments: MapMonument[];
  markers: MapMarkerPoint[];
}

function resolveVendingMarker(
  markers: MapMarkerPoint[],
  result: VendingSearchResult,
): MapMarkerPoint | undefined {
  if (result.markerId) {
    const byId = markers.find((m) => m.id === result.markerId);
    if (byId) return byId;
  }
  return markers.find(
    (m) =>
      m.type === 3 &&
      Math.abs(m.x - result.x) < 1 &&
      Math.abs(m.y - result.y) < 1 &&
      (!result.name || m.name === result.name),
  );
}

function vendingResultKey(result: VendingSearchResult, index: number): string {
  return result.markerId
    ? `${result.markerId}-${result.item}`
    : `${result.x}-${result.y}-${result.item}-${index}`;
}

const DEFAULT_LAYERS: MapLayers = {
  team: true,
  vending: true,
  monuments: true,
  events: true,
  grid: true,
  eventTypes: { ...DEFAULT_EVENT_TYPE_LAYERS },
};

export function MapPage() {
  const canSwitch = useCan("switch");
  const { epoch } = useActiveServer();
  const [searchParams] = useSearchParams();
  const memberParam = searchParams.get("member");
  const [mapImage, setMapImage] = useState<MapData["map"] | null>(null);
  const [team, setTeam] = useState<MapTeamMember[]>([]);
  const [monuments, setMonuments] = useState<MapMonument[]>([]);
  const [markers, setMarkers] = useState<MapMarkerPoint[]>([]);
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
  const [vendingQ, setVendingQ] = useState("");
  const [vendingCurrency, setVendingCurrency] = useState("");
  const [vendingMinPrice, setVendingMinPrice] = useState("");
  const [vendingMaxPrice, setVendingMaxPrice] = useState("");
  const [vendingMinMargin, setVendingMinMargin] = useState("");
  const [vendingSort, setVendingSort] = useState<"" | "price" | "margin">("");
  const [vending, setVending] = useState<VendingSearchResult[]>([]);
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [focusTarget, setFocusTarget] = useState<MapFocusTarget | null>(null);
  const [activeVendingKey, setActiveVendingKey] = useState<string | null>(null);
  const mapLayoutRef = useRef<HTMLDivElement>(null);
  const lastMemberFocusRef = useRef<string | null>(null);
  const [worldEvents, setWorldEvents] = useState<WorldEventsStatus | null>(null);
  const [drawings, setDrawings] = useState<MapDrawingStroke[]>([]);
  const [pins, setPins] = useState<MapPin[]>([]);
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(null);
  const [pendingDrawing, setPendingDrawing] = useState<{ points: MapDrawingPoint[] } | null>(null);
  const [drawColor, setDrawColor] = useState<string>(MAP_DRAWING_COLORS[0].value);
  const [pendingDrawingColor, setPendingDrawingColor] = useState<string>(MAP_DRAWING_COLORS[0].value);
  const [followSteamId, setFollowSteamId] = useState<string | null>(null);
  const [trackEventId, setTrackEventId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refreshLive = useCallback(async () => {
    if (isDemoMode()) {
      setTeam(demoTeam);
      setMarkers(demoMapMarkers);
      setLastUpdated(new Date());
      return;
    }

    const live = await apiFetch<{
      team: MapTeamMember[];
      markers: MapMarkerPoint[];
      worldEvents: WorldEventsStatus | null;
    }>("/servers/active/map/live");
    setTeam(live.team);
    setMarkers(live.markers);
    setWorldEvents(live.worldEvents);
    setLastUpdated(new Date());
  }, []);

  const mapImageSrc = useMapImageSrc(mapImage?.imageBase64);

  useEffect(() => {
    setLoading(true);
    setSelection(null);
    setFocusTarget(null);
    setFollowSteamId(null);
    setTrackEventId(null);
    Promise.all([
      apiFetch<MapData>("/servers/active/map"),
      apiFetch<MapOverlaysResponse>("/servers/active/map/overlays").catch(() => ({
        drawings: [],
        pins: [],
      })),
    ])
      .then(([data, overlays]) => {
        setMapImage(data.map);
        setTransform(data.transform);
        setTeam(data.team);
        setMonuments(data.monuments);
        setMarkers(data.markers);
        setDrawings(overlays.drawings);
        setPins(overlays.pins);
        setLastUpdated(new Date());
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
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

  useEffect(() => {
    if (loading) return;
    const interval = setInterval(() => {
      void refreshLive().catch(() => {
        // Keep showing the last good map if a live refresh fails.
      });
    }, 60_000);
    return () => clearInterval(interval);
  }, [loading, refreshLive]);

  useWebSocket((event, payload) => {
    if (event === "teamChanged") {
      const p = payload as { team?: { members?: MapTeamMember[] } } | null;
      if (p?.team?.members) {
        setTeam(p.team.members);
        setLastUpdated(new Date());
      }
      return;
    }
    if (event === "worldEventsChanged") {
      setWorldEvents(payload as WorldEventsStatus);
      setLastUpdated(new Date());
    }
  });

  const searchVending = async () => {
    const params = new URLSearchParams();
    if (vendingQ.trim()) params.set("q", vendingQ.trim());
    if (vendingCurrency.trim()) params.set("currency", vendingCurrency.trim());
    if (vendingMinPrice.trim()) params.set("minPrice", vendingMinPrice.trim());
    if (vendingMaxPrice.trim()) params.set("maxPrice", vendingMaxPrice.trim());
    if (vendingMinMargin.trim()) params.set("minProfitMargin", vendingMinMargin.trim());
    if (vendingSort) params.set("sort", vendingSort);

    if (
      !vendingQ.trim() &&
      !vendingCurrency.trim() &&
      !vendingMinPrice.trim() &&
      !vendingMaxPrice.trim() &&
      !vendingMinMargin.trim()
    ) {
      return;
    }

    const res = await apiFetch<{ results: VendingSearchResult[] }>(
      `/vending/search?${params.toString()}`,
    );
    setVending(res.results);
    setActiveVendingKey(null);
    setLayers((prev) => ({ ...prev, vending: true }));
  };

  const focusVendingResult = (result: VendingSearchResult, index: number) => {
    const markersOnMap = markers.length > 0 ? markers : isDemoMode() ? demoMapMarkers : [];
    const marker = resolveVendingMarker(markersOnMap, result);
    if (!marker) return;

    const key = vendingResultKey(result, index);
    setActiveVendingKey(key);
    setLayers((prev) => ({ ...prev, vending: true }));
    setSelection({ kind: "vending", markerId: marker.id });
    setFocusTarget({ worldX: marker.x, worldY: marker.y, nonce: Date.now() });
    mapLayoutRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const toggleLayer = (key: keyof Omit<MapLayers, "eventTypes">) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleProcgenLayer = (key: keyof MapProcgenLayers) => {
    setProcgenLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleEventType = (key: MapEventTypeKey) => {
    setLayers((prev) => ({
      ...prev,
      events: true,
      eventTypes: { ...prev.eventTypes, [key]: !prev.eventTypes[key] },
    }));
  };

  const toggleAllEventTypes = (enabled: boolean) => {
    setLayers((prev) => ({
      ...prev,
      eventTypes: (Object.keys(prev.eventTypes) as MapEventTypeKey[]).reduce(
        (acc, k) => {
          acc[k] = enabled;
          return acc;
        },
        {} as typeof prev.eventTypes,
      ),
    }));
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

  const mapW = mapImage?.width ?? demoMapSize.width;
  const mapH = mapImage?.height ?? demoMapSize.height;
  const teamOnMap = team.length > 0 ? team : isDemoMode() ? demoTeam : [];
  const monumentList = monuments.length > 0 ? monuments : isDemoMode() ? demoMonuments : [];
  const markerList = markers.length > 0 ? markers : isDemoMode() ? demoMapMarkers : [];
  const showDemoMap = isDemoMode() && mapImage && !mapImage.imageBase64;
  const vendingHighlights = vending.map((v) => ({ x: v.x, y: v.y }));
  const eventTrails = worldEvents
    ? {
        cargo: worldEvents.cargo.trail,
        heli: worldEvents.heli.trail,
      }
    : undefined;

  const eventCount = markerList.filter((m) => [2, 4, 5, 6, 7, 8].includes(m.type)).length;
  const eventTypeCounts = useMemo(() => {
    const counts: Record<MapEventTypeKey, number> = {
      cargo: 0,
      heli: 0,
      chinook: 0,
      vendor: 0,
      bradley: 0,
      convoy: 0,
      crate: 0,
      other: 0,
    };
    for (const m of markerList) {
      if (![2, 4, 5, 6, 7, 8].includes(m.type)) continue;
      counts[classifyMapEventMarker(m)]++;
    }
    return counts;
  }, [markerList]);
  const vendingCount = markerList.filter((m) => m.type === 3).length;
  const onlineCount = teamOnMap.filter((m) => m.isOnline).length;

  const mapTransform = transform ?? demoMapTransform;
  const worldSize = mapTransform.worldSize;
  const mapReady = Boolean(mapImage?.imageBase64 || showDemoMap);

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
    if (trackEventId && worldEvents) {
      const snap =
        trackEventId === "cargo"
          ? worldEvents.cargo
          : trackEventId === "heli"
            ? worldEvents.heli
            : trackEventId === "chinook"
              ? worldEvents.chinook
              : trackEventId === "vendor"
                ? worldEvents.vendor
                : null;
      if (snap?.x != null && snap?.y != null) {
        return { worldX: snap.x, worldY: snap.y };
      }
    }
    if (followMember?.x != null && followMember?.y != null) {
      return { worldX: followMember.x, worldY: followMember.y };
    }
    return null;
  }, [trackEventId, worldEvents, followMember]);

  const handleTrackEvent = (ev: MapTrackableEvent) => {
    if (ev.x == null || ev.y == null) return;
    setTrackEventId(ev.id);
    setFollowSteamId(null);
    setFocusTarget({ worldX: ev.x, worldY: ev.y, nonce: Date.now() });
    mapLayoutRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

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
          vendingCount={vendingCount}
          monumentCount={monumentList.length}
          eventCount={eventCount}
          eventTypeCounts={eventTypeCounts}
          showTeamOverlays={showTeamOverlays}
          drawings={drawings}
          pins={pins}
          canSwitch={canSwitch}
          onToggleLayer={toggleLayer}
          onToggleProcgenLayer={toggleProcgenLayer}
          onToggleEventType={toggleEventType}
          onToggleAllEventTypes={toggleAllEventTypes}
          onShowTeamOverlaysChange={setShowTeamOverlays}
          onRefresh={() => void refreshLive()}
          onDeletePin={deletePin}
          onDeleteDrawing={deleteDrawing}
          onSelectPin={(pinId) => setSelection({ kind: "pin", pinId })}
          onSelectDrawing={(drawingId) => setSelection({ kind: "drawing", drawingId })}
          worldEvents={worldEvents}
          trackingId={trackEventId}
          onTrackEvent={handleTrackEvent}
        />
        <div className="map-layout-main">
          {mapViewMode === "3d" && procgenReady ? (
            <Map3DView
              worldSize={worldSize}
              mapImageSrc={mapImageSrc}
              transform={mapTransform}
              team={teamOnMap}
              markers={markerList}
              monuments={monumentList}
              layers={layers}
              drawings={drawings}
              pins={pins}
              showTeamOverlays={showTeamOverlays}
              procgenLayers={procgenLayers}
              procgenPaths={procgenPaths}
              procgenPrefabs={procgenPrefabs}
              eventTrails={eventTrails}
              selection={selection}
              focusTarget={focusTarget}
              trackTarget={trackTarget}
              onUserPan={() => {
                setFollowSteamId(null);
                setTrackEventId(null);
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
            disablePan={annotateMode && canSwitch}
            toolbarExtra={annotateToolbar}
            onUserPan={() => {
              setFollowSteamId(null);
              setTrackEventId(null);
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
              markers={markerList}
              monuments={monumentList}
              layers={layers}
              highlighted={vendingHighlights}
              eventTrails={eventTrails}
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
            />
          </MapViewport>
          )}
        </div>
        <MapDetailPanel
          selection={selection}
          markers={markerList}
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
            setSelection(null);
          }}
          onSelect={setSelection}
          onFollowTeam={(steamId) => {
            setFollowSteamId(steamId);
            setTrackEventId(null);
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
        <p>Live team positions, vending machines, monuments, and world events.</p>
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
        {lastUpdated && (
          <p className="muted map-updated">Updated {lastUpdated.toLocaleTimeString()}</p>
        )}
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      {mapContent}

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2>Vending Search</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Filter by item or shop name, currency, price per item, and deals below median price.
        </p>
        <div className="search-row vending-search-row">
          <input
            type="text"
            value={vendingQ}
            onChange={(e) => setVendingQ(e.target.value)}
            placeholder="Item or shop name..."
            onKeyDown={(e) => e.key === "Enter" && void searchVending()}
          />
          <button type="button" onClick={() => void searchVending()}>
            Search
          </button>
        </div>
        <div className="vending-filters">
          <label>
            Currency
            <input
              type="text"
              value={vendingCurrency}
              onChange={(e) => setVendingCurrency(e.target.value)}
              placeholder="e.g. scrap, sulfur"
              onKeyDown={(e) => e.key === "Enter" && void searchVending()}
            />
          </label>
          <label>
            Min price
            <input
              type="number"
              min={0}
              value={vendingMinPrice}
              onChange={(e) => setVendingMinPrice(e.target.value)}
              placeholder="0"
              onKeyDown={(e) => e.key === "Enter" && void searchVending()}
            />
          </label>
          <label>
            Max price
            <input
              type="number"
              min={0}
              value={vendingMaxPrice}
              onChange={(e) => setVendingMaxPrice(e.target.value)}
              placeholder="Any"
              onKeyDown={(e) => e.key === "Enter" && void searchVending()}
            />
          </label>
          <label>
            Min deal %
            <input
              type="number"
              min={0}
              max={100}
              value={vendingMinMargin}
              onChange={(e) => setVendingMinMargin(e.target.value)}
              placeholder="Below median"
              title="Minimum percent below median price for this item"
              onKeyDown={(e) => e.key === "Enter" && void searchVending()}
            />
          </label>
          <label>
            Sort
            <select
              value={vendingSort}
              onChange={(e) => setVendingSort(e.target.value as "" | "price" | "margin")}
            >
              <option value="">Default</option>
              <option value="price">Price (low → high)</option>
              <option value="margin">Best deal first</option>
            </select>
          </label>
        </div>
        {vending.length > 0 && (
          <ul className="vending-list">
            {vending.slice(0, 20).map((v, i) => {
              const key = vendingResultKey(v, i);
              return (
                <li key={key}>
                  <button
                    type="button"
                    className={`vending-list-item${activeVendingKey === key ? " active" : ""}`}
                    onClick={() => focusVendingResult(v, i)}
                  >
                    <div className="vending-list-item-header">
                      <strong>{v.name}</strong>
                      <span className="muted">
                        @ {Math.round(v.x)}, {Math.round(v.y)}
                      </span>
                    </div>
                    <VendingTradeRow order={v} className="vending-list-trade" />
                    {v.profitMarginPercent != null && v.profitMarginPercent > 0 && (
                      <span className="vending-list-deal">{v.profitMarginPercent}% below median</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
