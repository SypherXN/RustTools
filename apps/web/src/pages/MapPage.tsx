import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

interface TeamMember {
  name: string;
  steamId: string;
  isOnline: boolean;
  x?: number;
  y?: number;
}

interface MapData {
  map: { width?: number; height?: number; imageBase64: string | null };
  team: TeamMember[];
}

interface VendingResult {
  name: string;
  x: number;
  y: number;
  item: string;
  quantity: number;
  costItem: string;
  costQuantity: number;
}

export function MapPage() {
  const [data, setData] = useState<MapData | null>(null);
  const [vendingQ, setVendingQ] = useState("");
  const [vending, setVending] = useState<VendingResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<MapData>("/servers/active/map")
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  const searchVending = async () => {
    if (!vendingQ.trim()) return;
    const res = await apiFetch<{ results: VendingResult[] }>(
      `/vending/search?q=${encodeURIComponent(vendingQ)}`,
    );
    setVending(res.results);
  };

  const mapW = data?.map.width ?? 1;
  const mapH = data?.map.height ?? 1;

  return (
    <div>
      <header className="page-header">
        <h1>Map</h1>
        <p>Server map with team positions.</p>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2>Vending Search</h2>
        <div className="search-row">
          <input
            value={vendingQ}
            onChange={(e) => setVendingQ(e.target.value)}
            placeholder="Search items or shops..."
          />
          <button type="button" onClick={() => void searchVending()}>
            Search
          </button>
        </div>
        {vending.length > 0 && (
          <ul className="vending-list">
            {vending.slice(0, 20).map((v, i) => (
              <li key={i}>
                <strong>{v.name}</strong> — item {v.item} x{v.quantity} for {v.costQuantity} {v.costItem}
              </li>
            ))}
          </ul>
        )}
      </section>

      {data?.map.imageBase64 ? (
        <div className="map-container map-overlay-wrap">
          <img
            src={`data:image/jpeg;base64,${data.map.imageBase64}`}
            alt="Rust server map"
            className="map-image"
          />
          <svg className="map-overlay" viewBox={`0 0 ${mapW} ${mapH}`} preserveAspectRatio="none">
            {data.team
              .filter((m) => m.x != null && m.y != null)
              .map((m) => (
                <g key={m.steamId}>
                  <circle
                    cx={m.x}
                    cy={mapH - (m.y ?? 0)}
                    r={8}
                    className={m.isOnline ? "map-dot online" : "map-dot offline"}
                  />
                  <text x={(m.x ?? 0) + 10} y={mapH - (m.y ?? 0) + 4} className="map-label">
                    {m.name}
                  </text>
                </g>
              ))}
          </svg>
        </div>
      ) : (
        <p className="muted">Map unavailable. Connect a Rust+ server first.</p>
      )}

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Team on Map</h2>
        <ul className="team-list">
          {(data?.team ?? []).map((m) => (
            <li key={m.steamId}>
              <span className={m.isOnline ? "dot online" : "dot offline"} />
              {m.name}
              {m.x != null && m.y != null ? ` — ${m.x}, ${m.y}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
