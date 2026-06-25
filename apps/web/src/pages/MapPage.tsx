import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { MapCoordinateTransform } from "@rusttools/shared";
import { MapGridOverlay } from "../components/MapGridOverlay";
import { MapDetailPanel, type MapSelection } from "../components/MapDetailPanel";
import { MapOverlay, type MapLayers, type MapMarkerPoint, type MapMonument, type MapTeamMember } from "../components/MapOverlay";
import { MapViewport, type MapFocusTarget } from "../components/MapViewport";
import { useMapImageSrc } from "../hooks/useMapImageSrc";
import { useWebSocket } from "../hooks/useWebSocket";
import { apiFetch } from "../lib/api";
import { demoMapMarkers, demoMapSize, demoMonuments, demoTeam, demoMapTransform, isDemoMode } from "../lib/demo";

interface MapData {
  map: { width?: number; height?: number; imageBase64: string | null };
  transform: MapCoordinateTransform;
  team: MapTeamMember[];
  monuments: MapMonument[];
  markers: MapMarkerPoint[];
}

import type { VendingSearchResult } from "@rusttools/shared";

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
};

export function MapPage() {
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

    const live = await apiFetch<{ team: MapTeamMember[]; markers: MapMarkerPoint[] }>(
      "/servers/active/map/live",
    );
    setTeam(live.team);
    setMarkers(live.markers);
    setLastUpdated(new Date());
  }, []);

  const mapImageSrc = useMapImageSrc(mapImage?.imageBase64);

  useEffect(() => {
    setLoading(true);
    apiFetch<MapData>("/servers/active/map")
      .then((data) => {
        setMapImage(data.map);
        setTransform(data.transform);
        setTeam(data.team);
        setMonuments(data.monuments);
        setMarkers(data.markers);
        setLastUpdated(new Date());
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading) return;
    const interval = setInterval(() => {
      void refreshLive().catch(() => {
        // Keep showing the last good map if a live refresh fails.
      });
    }, 30_000);
    return () => clearInterval(interval);
  }, [loading, refreshLive]);

  useWebSocket((event, payload) => {
    if (event !== "teamChanged") return;
    const p = payload as { team?: { members?: MapTeamMember[] } } | null;
    if (p?.team?.members) {
      setTeam(p.team.members);
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

  const toggleLayer = (key: keyof MapLayers) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const mapW = mapImage?.width ?? demoMapSize.width;
  const mapH = mapImage?.height ?? demoMapSize.height;
  const teamOnMap = team.length > 0 ? team : isDemoMode() ? demoTeam : [];
  const monumentList = monuments.length > 0 ? monuments : isDemoMode() ? demoMonuments : [];
  const markerList = markers.length > 0 ? markers : isDemoMode() ? demoMapMarkers : [];
  const showDemoMap = isDemoMode() && mapImage && !mapImage.imageBase64;
  const vendingHighlights = vending.map((v) => ({ x: v.x, y: v.y }));

  const eventCount = markerList.filter((m) => [2, 4, 5, 6, 7, 8].includes(m.type)).length;
  const vendingCount = markerList.filter((m) => m.type === 3).length;
  const onlineCount = teamOnMap.filter((m) => m.isOnline).length;

  const mapTransform = transform ?? demoMapTransform;
  const worldSize = mapTransform.worldSize;
  const mapReady = Boolean(mapImage?.imageBase64 || showDemoMap);

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
        <div className="map-layout-main">
          <MapViewport
            width={mapW}
            height={mapH}
            imageSrc={mapImageSrc}
            demo={Boolean(showDemoMap)}
            transform={mapTransform}
            focusTarget={focusTarget}
          >
            {layers.grid && (
              <MapGridOverlay width={mapW} height={mapH} transform={mapTransform} />
            )}
            <MapOverlay
              width={mapW}
              height={mapH}
              transform={mapTransform}
              team={teamOnMap}
              markers={markerList}
              monuments={monumentList}
              layers={layers}
              highlighted={vendingHighlights}
              selection={selection}
              onSelect={setSelection}
            />
          </MapViewport>
        </div>
        <MapDetailPanel
          selection={selection}
          markers={markerList}
          monuments={monumentList}
          team={teamOnMap}
          worldSize={worldSize}
          onClose={() => setSelection(null)}
          onSelect={setSelection}
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
        {lastUpdated && (
          <p className="muted map-updated">Updated {lastUpdated.toLocaleTimeString()}</p>
        )}
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="card map-controls" style={{ marginBottom: "1rem" }}>
        <h2>Layers</h2>
        <div className="map-layer-toggles">
          <label>
            <input type="checkbox" checked={layers.team} onChange={() => toggleLayer("team")} />
            Team ({onlineCount} online / {teamOnMap.length})
          </label>
          <label>
            <input type="checkbox" checked={layers.vending} onChange={() => toggleLayer("vending")} />
            Vending ({vendingCount})
          </label>
          <label>
            <input
              type="checkbox"
              checked={layers.monuments}
              onChange={() => toggleLayer("monuments")}
            />
            Monuments ({monumentList.length})
          </label>
          <label>
            <input type="checkbox" checked={layers.events} onChange={() => toggleLayer("events")} />
            Events ({eventCount})
          </label>
          <label>
            <input type="checkbox" checked={layers.grid} onChange={() => toggleLayer("grid")} />
            Grid
          </label>
          <button type="button" className="btn-secondary" onClick={() => void refreshLive()}>
            Refresh now
          </button>
        </div>
        <ul className="map-legend">
          <li><span className="legend-swatch team-online" /> Team (online)</li>
          <li><span className="legend-swatch team-offline" /> Team (offline)</li>
          <li><span className="legend-swatch vending" /> Vending (in stock)</li>
          <li><span className="legend-swatch vending-out" /> Vending (empty)</li>
          <li><span className="legend-swatch monument" /> Monument</li>
          <li><span className="legend-swatch events" /> Events (cargo, heli, etc.)</li>
          <li><span className="legend-swatch grid" /> Grid (150m cells)</li>
        </ul>
      </section>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2>Vending Search</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Filter by item or shop name, currency, price per item, and deals below median price.
        </p>
        <div className="search-row">
          <input
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
              const deal =
                v.profitMarginPercent != null && v.profitMarginPercent > 0
                  ? ` · ${v.profitMarginPercent}% below median`
                  : "";
              return (
                <li key={key}>
                  <button
                    type="button"
                    className={`vending-list-item${activeVendingKey === key ? " active" : ""}`}
                    onClick={() => focusVendingResult(v, i)}
                  >
                    <strong>{v.name}</strong> @ {Math.round(v.x)}, {Math.round(v.y)} — {v.itemName}{" "}
                    ×{v.quantity} for {v.costQuantity.toLocaleString()} {v.costItemName}
                    {deal}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {mapContent}
    </div>
  );
}
