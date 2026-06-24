import { useEffect, useMemo, useState } from "react";
import type {
  ParsedStorage,
  StorageContainerKind,
  StorageItemSearchMatch,
} from "@rusttools/shared";
import { parseStorageEntityInfo } from "@rusttools/shared";
import { StorageContentsGrid, StorageUpkeepBanner } from "../components/StorageContentsGrid";
import { StorageIconPicker } from "../components/StorageIconPicker";
import { apiFetch } from "../lib/api";
import { useWebSocket } from "../hooks/useWebSocket";
import { useCan } from "../hooks/usePermissions";

interface Monitor {
  id: string;
  name: string;
  displayName: string | null;
  entityId: number;
  icon: string | null;
  iconShortname: string;
  iconUrl: string;
  iconName: string;
  containerKind: StorageContainerKind;
  iconAutoDetected: boolean;
}

interface StorageInfo {
  recycle?: { scrap: number; extras: Record<string, number> };
  parsed?: ParsedStorage | null;
  info: unknown;
}

interface ItemSearchResponse {
  query: string;
  matches: StorageItemSearchMatch[];
  failed: Array<{ id: string; name: string; error: string }>;
}

export function StoragePage() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [monitorSearch, setMonitorSearch] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [itemResults, setItemResults] = useState<ItemSearchResponse | null>(null);
  const [itemSearchLoading, setItemSearchLoading] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const canAdmin = useCan("admin");

  const loadMonitors = async () => {
    const data = await apiFetch<{ monitors: Monitor[] }>("/storage");
    setMonitors(data.monitors);
  };

  useEffect(() => {
    loadMonitors().catch((err: Error) => setError(err.message));
  }, []);

  useWebSocket((event, payload) => {
    if (event === "storageChanged") {
      const p = payload as { name?: string };
      setAlert(`Storage changed: ${p.name ?? "monitor"}`);
      if (selected) void loadInfo(selected);
      if (itemResults?.query) void runItemSearch(itemResults.query);
      void loadMonitors();
    }
  });

  const selectedMonitor = monitors.find((m) => m.id === selected) ?? null;

  const filteredMonitors = useMemo(() => {
    const q = monitorSearch.trim().toLowerCase();
    if (!q) return monitors;
    return monitors.filter((m) => (m.displayName ?? m.name).toLowerCase().includes(q));
  }, [monitorSearch, monitors]);

  const loadInfo = async (id: string) => {
    setSelected(id);
    try {
      const data = await apiFetch<{
        info: unknown;
        parsed?: ParsedStorage | null;
        recycle?: StorageInfo["recycle"];
      }>(`/devices/${id}/info`);
      setStorage({
        info: data.info,
        parsed: data.parsed ?? parseStorageEntityInfo(data.info),
        recycle: data.recycle,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load storage");
    }
  };

  const saveIcon = async (shortname: string | null) => {
    if (!selectedMonitor) return;
    await apiFetch(`/devices/${selectedMonitor.id}`, {
      method: "PATCH",
      body: JSON.stringify({ icon: shortname }),
    });
    await loadMonitors();
  };

  const runItemSearch = async (query = itemSearch) => {
    if (!query.trim()) return;
    setItemSearchLoading(true);
    try {
      const data = await apiFetch<ItemSearchResponse>(
        `/storage/items/search?q=${encodeURIComponent(query)}`,
      );
      setItemResults(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Item search failed");
    } finally {
      setItemSearchLoading(false);
    }
  };

  const parsed = storage?.parsed ?? null;
  const showIconPicker =
    selectedMonitor &&
    (selectedMonitor.containerKind === "large_box" ||
      selectedMonitor.containerKind === "unknown" ||
      selectedMonitor.containerKind === "tool_cupboard" ||
      selectedMonitor.containerKind === "small_box");

  return (
    <div>
      <header className="page-header">
        <h1>Storage</h1>
        <p>Storage monitor contents, TC upkeep, and recycle estimates.</p>
      </header>

      {alert && <div className="alert">{alert}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2>Find item across monitors</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Search by item name or shortname (e.g. sulfur, rifle.ak).
        </p>
        <div className="search-row">
          <input
            type="text"
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runItemSearch();
            }}
            placeholder="Search items..."
          />
          <button type="button" onClick={() => void runItemSearch()} disabled={itemSearchLoading}>
            {itemSearchLoading ? "Searching…" : "Search"}
          </button>
        </div>

        {itemResults && (
          <div className="storage-item-search-results">
            {itemResults.matches.length === 0 ? (
              <p className="muted">No matches for &ldquo;{itemResults.query}&rdquo;.</p>
            ) : (
              itemResults.matches.map((match) => (
                <div key={match.itemId} className="storage-item-search-match">
                  <div className="storage-item-search-header">
                    <img className="storage-item-search-icon" src={match.iconUrl} alt="" />
                    <div>
                      <strong>{match.name}</strong>
                      <div className="muted storage-item-search-total">
                        Total: {match.total.toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <table className="data-table storage-item-search-table">
                    <thead>
                      <tr>
                        <th>Monitor</th>
                        <th>Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {match.monitors.map((hit) => (
                        <tr key={hit.id}>
                          <td>
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => void loadInfo(hit.id)}
                            >
                              {hit.name}
                            </button>
                          </td>
                          <td>{hit.quantity.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
            {itemResults.failed.length > 0 && (
              <p className="muted storage-item-search-failed">
                Could not read: {itemResults.failed.map((f) => f.name).join(", ")}
              </p>
            )}
          </div>
        )}
      </section>

      <div className="search-row" style={{ marginBottom: "1rem" }}>
        <input
          type="text"
          value={monitorSearch}
          onChange={(e) => setMonitorSearch(e.target.value)}
          placeholder="Filter monitors by name..."
        />
      </div>

      <section className="card storage-monitors-section">
        <h2>Monitors</h2>
        {filteredMonitors.length === 0 ? (
          <p className="muted">No storage monitors paired.</p>
        ) : (
          <div className="storage-monitor-grid">
            {filteredMonitors.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`storage-monitor-card${selected === m.id ? " active" : ""}`}
                onClick={() => void loadInfo(m.id)}
                title={m.displayName ?? m.name}
              >
                <img className="storage-monitor-card-icon" src={m.iconUrl} alt="" />
                <span className="storage-monitor-card-name">{m.displayName ?? m.name}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card storage-contents-card">
          <div className="storage-contents-header">
            <h2>Contents</h2>
            {selectedMonitor && (
              <div className="storage-contents-monitor-meta">
                <img
                  className="storage-monitor-icon storage-monitor-icon-lg"
                  src={selectedMonitor.iconUrl}
                  alt=""
                />
                <div>
                  <strong>{selectedMonitor.displayName ?? selectedMonitor.name}</strong>
                  <div className="muted">{selectedMonitor.iconName}</div>
                </div>
                {showIconPicker && canAdmin && (
                  <button type="button" onClick={() => setIconPickerOpen(true)}>
                    Change icon
                  </button>
                )}
              </div>
            )}
          </div>
          {parsed && <StorageUpkeepBanner parsed={parsed} />}
          {storage?.recycle && storage.recycle.scrap > 0 && (
            <div className="recycle-box">
              <strong>Recycle estimate:</strong> {storage.recycle.scrap} scrap
              {Object.keys(storage.recycle.extras).length > 0 && (
                <span className="muted">
                  {" "}
                  +{" "}
                  {Object.entries(storage.recycle.extras)
                    .map(([name, qty]) => `${qty} ${name}`)
                    .join(", ")}
                </span>
              )}
            </div>
          )}
          {parsed ? (
            parsed.items.length > 0 ? (
              <StorageContentsGrid parsed={parsed} />
            ) : (
              <p className="muted">Container is empty.</p>
            )
          ) : (
            <p className="muted">Select a monitor to view contents.</p>
          )}
        </section>

      {iconPickerOpen && selectedMonitor && canAdmin && (
        <StorageIconPicker
          kind={selectedMonitor.containerKind}
          currentShortname={selectedMonitor.iconShortname}
          autoDetected={selectedMonitor.iconAutoDetected}
          onSave={saveIcon}
          onClose={() => setIconPickerOpen(false)}
        />
      )}
    </div>
  );
}
