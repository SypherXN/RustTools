import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { groupDevicesByType } from "@rusttools/shared";
import { apiFetch } from "../lib/api";
import { useWebSocket } from "../hooks/useWebSocket";
import { useCan } from "../hooks/usePermissions";

interface Device {
  id: string;
  entityId: number;
  entityType: string;
  name: string;
  displayName: string | null;
}

export function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [groupName, setGroupName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveEvent, setLiveEvent] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const canSwitch = useCan("switch");
  const canAdmin = useCan("admin");

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ devices: Device[] }>("/devices");
      setDevices(data.devices);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load devices");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useWebSocket((event, payload) => {
    if (event === "entityChanged") {
      setLiveEvent(`Device update: entity ${(payload as { entityId?: number }).entityId}`);
      void load();
    }
  });

  const groupedDevices = useMemo(() => groupDevicesByType(devices), [devices]);
  const switchCount = devices.filter((d) => d.entityType === "smart_switch").length;

  const toggle = async (device: Device, action: "on" | "off" | "toggle") => {
    try {
      await apiFetch(`/devices/${device.id}/toggle`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    }
  };

  const toggleGroup = async (value: boolean) => {
    if (!groupName.trim()) return;
    try {
      await apiFetch("/devices/switch-group", {
        method: "POST",
        body: JSON.stringify({ name: groupName, value }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Group toggle failed");
    }
  };

  const saveRename = async (id: string) => {
    await apiFetch(`/devices/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ displayName: renameValue }),
    });
    setRenaming(null);
    await load();
  };

  return (
    <div>
      <header className="page-header">
        <h1>Devices</h1>
        <p>Rust+ smart components paired to your active server.</p>
      </header>

      {liveEvent && <div className="alert">{liveEvent}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {switchCount > 0 && canSwitch && (
        <section className="card" style={{ marginBottom: "1rem" }}>
          <h2>Switch Group</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Toggle every smart switch that shares the same in-game name.
          </p>
          <div className="search-row">
            <input
              placeholder="Group name (in-game switch name)"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
            <button type="button" onClick={() => void toggleGroup(true)}>
              All On
            </button>
            <button type="button" onClick={() => void toggleGroup(false)}>
              All Off
            </button>
          </div>
        </section>
      )}

      {loading && <p>Loading devices...</p>}
      {!loading && devices.length === 0 && (
        <p className="muted">No devices paired yet. Use the wire tool in-game while FCM is listening.</p>
      )}

      {!loading &&
        groupedDevices.map(({ meta, devices: sectionDevices }) => (
          <section key={meta.type} className="device-type-section">
            <header className="device-type-header">
              <img className="device-type-icon" src={meta.iconUrl} alt="" />
              <h2>{meta.title}</h2>
              <span className="badge">{sectionDevices.length}</span>
            </header>
            <ul className="device-list device-type-grid">
              {sectionDevices.map((device) => (
                <li key={device.id} className="card device-card">
                  <div className="device-card-row">
                    <img
                      className="device-card-icon"
                      src={meta.iconUrl}
                      alt=""
                      title={meta.inGameItem}
                    />
                    <div className="device-card-main">
                    {renaming === device.id && canAdmin ? (
                      <div className="search-row">
                        <input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                        />
                        <button type="button" onClick={() => void saveRename(device.id)}>
                          Save
                        </button>
                      </div>
                    ) : (
                      <>
                        <strong>{device.displayName ?? device.name}</strong>
                        {device.displayName && device.displayName !== device.name && (
                          <div className="muted device-card-ingame">{device.name}</div>
                        )}
                        {canAdmin && (
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => {
                              setRenaming(device.id);
                              setRenameValue(device.displayName ?? device.name);
                            }}
                          >
                            Rename
                          </button>
                        )}
                      </>
                    )}
                    </div>
                  </div>
                  {device.entityType === "smart_switch" && canSwitch && (
                    <div className="btn-row">
                      <button type="button" onClick={() => void toggle(device, "on")}>
                        On
                      </button>
                      <button type="button" onClick={() => void toggle(device, "off")}>
                        Off
                      </button>
                      <button type="button" onClick={() => void toggle(device, "toggle")}>
                        Toggle
                      </button>
                    </div>
                  )}
                  {device.entityType === "smart_alarm" && (
                    <p className="muted device-card-hint">Alerts via Rust+ when powered in-game.</p>
                  )}
                  {device.entityType === "storage_monitor" && (
                    <Link to="/storage" className="device-card-link">
                      View in Storage →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
