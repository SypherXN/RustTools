import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { useWebSocket } from "../hooks/useWebSocket";

interface Monitor {
  id: string;
  name: string;
  displayName: string | null;
  entityId: number;
}

interface StorageInfo {
  recycle?: { scrap: number; extras: Record<string, number> };
  info: unknown;
}

export function StoragePage() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ monitors: Monitor[] }>("/storage")
      .then((data) => setMonitors(data.monitors))
      .catch((err: Error) => setError(err.message));
  }, []);

  useWebSocket((event, payload) => {
    if (event === "storageChanged") {
      const p = payload as { name?: string };
      setAlert(`Storage changed: ${p.name ?? "monitor"}`);
      if (selected) void loadInfo(selected);
    }
  });

  const loadInfo = async (id: string) => {
    setSelected(id);
    try {
      const data = await apiFetch<{ info: unknown; recycle?: StorageInfo["recycle"] }>(
        `/devices/${id}/info`,
      );
      setStorage({ info: data.info, recycle: data.recycle });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load storage");
    }
  };

  const runSearch = async () => {
    if (!search.trim()) return;
    try {
      const data = await apiFetch<{ monitors: Monitor[] }>(
        `/storage/search?q=${encodeURIComponent(search)}`,
      );
      setMonitors(data.monitors);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    }
  };

  return (
    <div>
      <header className="page-header">
        <h1>Storage</h1>
        <p>Storage monitor contents, TC upkeep, and recycle estimates.</p>
      </header>

      {alert && <div className="alert">{alert}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="search-row" style={{ marginBottom: "1rem" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search monitors by name..."
        />
        <button type="button" onClick={() => void runSearch()}>
          Search
        </button>
      </div>

      <div className="grid">
        <section className="card">
          <h2>Monitors</h2>
          {monitors.length === 0 && <p className="muted">No storage monitors paired.</p>}
          <ul className="device-list">
            {monitors.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={`link-btn ${selected === m.id ? "active" : ""}`}
                  onClick={() => void loadInfo(m.id)}
                >
                  {m.displayName ?? m.name}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Contents</h2>
          {storage?.recycle && (
            <div className="recycle-box">
              <strong>Recycle estimate:</strong> {storage.recycle.scrap} scrap
              {Object.keys(storage.recycle.extras).length > 0 && (
                <span className="muted">
                  {" "}
                  + {JSON.stringify(storage.recycle.extras)}
                </span>
              )}
            </div>
          )}
          {storage ? (
            <pre className="code-block">{JSON.stringify(storage.info, null, 2)}</pre>
          ) : (
            <p className="muted">Select a monitor to view contents.</p>
          )}
        </section>
      </div>
    </div>
  );
}
