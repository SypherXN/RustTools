import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  groupDevicesByType,
  parseSwitchEntityValue,
  type EntityDeviceSettings,
  type SwitchAutoMode,
  type SwitchGroupRecord,
} from "@rusttools/shared";
import { apiFetch } from "../lib/api";
import { peekApiCache } from "../lib/api-cache";
import { LastUpdatedLine } from "../components/LastUpdatedLine";
import { DiscordRolePicker } from "../components/DiscordRolePicker";

import { useWebSocket } from "../hooks/WebSocketProvider";
import { useCan } from "../hooks/usePermissions";
import { useActiveServer } from "../hooks/useActiveServer";

const LIVE_CAMERAS_ENABLED = import.meta.env.VITE_LIVE_CAMERAS !== "false";

interface Device {
  id: string;
  entityId: number;
  entityType: string;
  name: string;
  displayName: string | null;
  switchValue?: boolean | null;
}

function SwitchStateBadge({ value }: { value: boolean | null | undefined }) {
  if (value === true) {
    return <span className="switch-state-badge switch-state-badge-on">ON</span>;
  }
  if (value === false) {
    return <span className="switch-state-badge switch-state-badge-off">OFF</span>;
  }
  return <span className="switch-state-badge switch-state-badge-unknown">Unknown</span>;
}

const AUTO_MODES: Array<{ value: SwitchAutoMode | ""; label: string }> = [
  { value: "", label: "None" },
  { value: "auto-day-night", label: "On at night" },
  { value: "auto-night-day", label: "On at day" },
  { value: "auto-on", label: "Always on" },
  { value: "auto-off", label: "Always off" },
  { value: "any-online", label: "Any teammate online" },
  { value: "proximity", label: "Teammate nearby" },
];

export function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [switchGroups, setSwitchGroups] = useState<SwitchGroupRecord[]>([]);
  const [groupName, setGroupName] = useState("");
  const [activeTab, setActiveTab] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dataFetchedAt, setDataFetchedAt] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [expandedSettings, setExpandedSettings] = useState<string | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<EntityDeviceSettings>({});
  const canSwitch = useCan("switch");
  const canAdmin = useCan("admin");
  const { epoch } = useActiveServer();

  const load = async (options?: { silent?: boolean }) => {
    const cachedDevices = peekApiCache<{ devices: Device[] }>("/devices");
    const cachedStates = peekApiCache<{ states: Record<string, boolean | null> }>("/devices/switch-states");
    const cachedGroups = peekApiCache<{ groups: SwitchGroupRecord[] }>("/switch-groups");

    if (!options?.silent) {
      if (cachedDevices) {
        const states = cachedStates?.value.states ?? {};
        setDevices(
          cachedDevices.value.devices.map((device) =>
            device.entityType === "smart_switch"
              ? { ...device, switchValue: states[device.id] ?? null }
              : device,
          ),
        );
        if (cachedGroups) setSwitchGroups(cachedGroups.value.groups);
        setDataFetchedAt(cachedDevices.fetchedAt);
        setLoading(false);
      } else {
        setLoading(true);
      }
    }
    if (!options?.silent) setRefreshing(true);

    try {
      const [deviceData, statesData, groupData] = await Promise.all([
        apiFetch<{ devices: Device[] }>("/devices"),
        apiFetch<{ states: Record<string, boolean | null> }>("/devices/switch-states"),
        apiFetch<{ groups: SwitchGroupRecord[] }>("/switch-groups").catch(() => ({ groups: [] })),
      ]);
      setDevices(
        deviceData.devices.map((device) =>
          device.entityType === "smart_switch"
            ? { ...device, switchValue: statesData.states[device.id] ?? null }
            : device,
        ),
      );
      setSwitchGroups(groupData.groups);
      setDataFetchedAt(Date.now());
      setError(null);
    } catch (err) {
      if (!cachedDevices) {
        setError(err instanceof Error ? err.message : "Failed to load devices");
      }
    } finally {
      if (!options?.silent) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    void load();
  }, [epoch]);

  useWebSocket((event, payload) => {
    if (event !== "entityChanged") return;

    const data = payload as { entityId?: number; payload?: unknown };
    const switchValue = parseSwitchEntityValue(data.payload);
    if (data.entityId != null && switchValue !== null) {
      setDevices((prev) =>
        prev.map((device) =>
          device.entityId === data.entityId && device.entityType === "smart_switch"
            ? { ...device, switchValue }
            : device,
        ),
      );
      return;
    }

    void (async () => {
      const device = devices.find((d) => d.entityId === data.entityId);
      if (device?.entityType === "smart_switch") {
        try {
          const { states } = await apiFetch<{ states: Record<string, boolean | null> }>(
            `/devices/switch-states?entityDbId=${encodeURIComponent(device.id)}`,
          );
          const value = states[device.id];
          if (value !== undefined) {
            setDevices((prev) =>
              prev.map((d) => (d.id === device.id ? { ...d, switchValue: value } : d)),
            );
            return;
          }
        } catch {
          // fall through to full reload
        }
      }
      void load({ silent: true });
    })();
  });

  const groupedDevices = useMemo(() => groupDevicesByType(devices), [devices]);
  const switchCount = devices.filter((d) => d.entityType === "smart_switch").length;

  useEffect(() => {
    if (groupedDevices.length === 0) return;
    if (!activeTab || !groupedDevices.some((g) => g.meta.type === activeTab)) {
      setActiveTab(groupedDevices[0]!.meta.type);
    }
  }, [groupedDevices, activeTab]);

  const activeGroup = groupedDevices.find((g) => g.meta.type === activeTab);

  const toggle = async (device: Device, action: "on" | "off" | "toggle") => {
    try {
      const result = await apiFetch<{ ok: boolean; value: boolean }>(`/devices/${device.id}/toggle`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      setDevices((prev) =>
        prev.map((d) => (d.id === device.id ? { ...d, switchValue: result.value } : d)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    }
  };

  const toggleGroupByName = async (value: boolean) => {
    if (!groupName.trim()) return;
    try {
      await apiFetch("/devices/switch-group", {
        method: "POST",
        body: JSON.stringify({ name: groupName, value }),
      });
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Group toggle failed");
    }
  };

  const toggleSwitchGroup = async (
    groupId: string,
    action: "on" | "off" | "toggle",
  ) => {
    try {
      await apiFetch(`/switch-groups/${groupId}/toggle`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Switch group toggle failed");
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

  const openSettings = async (deviceId: string) => {
    if (expandedSettings === deviceId) {
      setExpandedSettings(null);
      return;
    }
    const data = await apiFetch<{ settings: EntityDeviceSettings }>(`/devices/${deviceId}/settings`);
    setSettingsDraft(data.settings);
    setExpandedSettings(deviceId);
  };

  const saveSettings = async (deviceId: string) => {
    await apiFetch(`/devices/${deviceId}/settings`, {
      method: "PATCH",
      body: JSON.stringify(settingsDraft),
    });
    setExpandedSettings(null);
  };

  return (
    <div>
      <header className="page-header">
        <h1>Devices</h1>
        <p>Rust+ smart components paired to your active server.</p>
        <LastUpdatedLine fetchedAt={dataFetchedAt} refreshing={refreshing} />
        {LIVE_CAMERAS_ENABLED && (
          <div className="btn-row">
            <Link to="/cameras">Live cameras →</Link>
          </div>
        )}
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      {canSwitch && switchGroups.length > 0 && (
        <section className="card" style={{ marginBottom: "1rem" }}>
          <h2>Switch groups</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Toggle named groups of smart switches. Configure groups on the Automations page.
          </p>
          <div className="switch-groups-quick">
            {switchGroups.map((group) => (
              <div key={group.id} className="card switch-group-card">
                <strong>{group.displayName ?? group.name}</strong>
                {group.chatCommand && (
                  <p className="muted device-card-hint">
                    Chat: <code>!{group.chatCommand}</code>
                  </p>
                )}
                <p className="muted device-card-hint">{group.memberEntityIds.length} switch(es)</p>
                <div className="btn-row">
                  <button type="button" onClick={() => void toggleSwitchGroup(group.id, "on")}>
                    On
                  </button>
                  <button type="button" onClick={() => void toggleSwitchGroup(group.id, "off")}>
                    Off
                  </button>
                  <button type="button" onClick={() => void toggleSwitchGroup(group.id, "toggle")}>
                    Toggle
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {switchCount > 0 && canSwitch && (
        <section className="card" style={{ marginBottom: "1rem" }}>
          <h2>Quick switch by name</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Toggle every smart switch that shares the same in-game name.
          </p>
          <div className="search-row">
            <input
              placeholder="Group name (in-game switch name)"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
            <button type="button" onClick={() => void toggleGroupByName(true)}>
              All On
            </button>
            <button type="button" onClick={() => void toggleGroupByName(false)}>
              All Off
            </button>
          </div>
        </section>
      )}

      {loading && <p>Loading devices...</p>}
      {!loading && devices.length === 0 && (
        <p className="muted">No devices paired yet. Use the wire tool in-game while FCM is listening.</p>
      )}

      {!loading && groupedDevices.length > 0 && (
        <>
          <nav className="device-type-tabs">
            {groupedDevices.map(({ meta, devices: sectionDevices }) => (
              <button
                key={meta.type}
                type="button"
                className={activeTab === meta.type ? "btn-primary" : "btn-secondary"}
                onClick={() => setActiveTab(meta.type)}
              >
                {meta.title} ({sectionDevices.length})
              </button>
            ))}
          </nav>

          {activeGroup && (
            <section className="device-type-section">
              <header className="device-type-header">
                <img className="device-type-icon" src={activeGroup.meta.iconUrl} alt="" />
                <h2>{activeGroup.meta.title}</h2>
                <span className="badge">{activeGroup.devices.length}</span>
              </header>
              <ul className="device-list device-type-grid">
                {activeGroup.devices.map((device) => (
                  <li key={device.id} className="card device-card">
                    <div className="device-card-row">
                      <img
                        className="device-card-icon"
                        src={activeGroup.meta.iconUrl}
                        alt=""
                        title={activeGroup.meta.inGameItem}
                      />
                      <div className="device-card-main">
                        {renaming === device.id && canAdmin ? (
                          <div className="search-row">
                            <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
                            <button type="button" onClick={() => void saveRename(device.id)}>
                              Save
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="device-card-title-row">
                              <strong>{device.displayName ?? device.name}</strong>
                              {device.entityType === "smart_switch" && (
                                <SwitchStateBadge value={device.switchValue} />
                              )}
                            </div>
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
                      <div className="btn-row device-switch-actions">
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
                    {canAdmin &&
                      (device.entityType === "smart_switch" || device.entityType === "smart_alarm") && (
                        <button type="button" className="link-btn" onClick={() => void openSettings(device.id)}>
                          {expandedSettings === device.id ? "Hide settings" : "Settings"}
                        </button>
                      )}
                    {expandedSettings === device.id && (
                      <div className="device-settings-panel">
                        {device.entityType === "smart_switch" && (
                          <>
                            <label>
                              Chat command alias
                              <input
                                placeholder="e.g. lights → !lights on"
                                value={settingsDraft.switch?.chatCommand ?? ""}
                                onChange={(e) =>
                                  setSettingsDraft({
                                    ...settingsDraft,
                                    switch: { ...settingsDraft.switch, chatCommand: e.target.value || null },
                                  })
                                }
                              />
                            </label>
                            <label>
                              Auto mode
                              <select
                                value={settingsDraft.switch?.autoMode ?? ""}
                                onChange={(e) =>
                                  setSettingsDraft({
                                    ...settingsDraft,
                                    switch: {
                                      ...settingsDraft.switch,
                                      autoMode: (e.target.value || null) as SwitchAutoMode | null,
                                    },
                                  })
                                }
                              >
                                {AUTO_MODES.map((m) => (
                                  <option key={m.label} value={m.value}>
                                    {m.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {settingsDraft.switch?.autoMode === "proximity" && (
                              <label>
                                Proximity grid radius
                                <input
                                  type="number"
                                  min={1}
                                  max={10}
                                  value={settingsDraft.switch?.proximityGridRadius ?? 1}
                                  onChange={(e) =>
                                    setSettingsDraft({
                                      ...settingsDraft,
                                      switch: {
                                        ...settingsDraft.switch,
                                        proximityGridRadius: Number(e.target.value),
                                      },
                                    })
                                  }
                                />
                              </label>
                            )}
                          </>
                        )}
                        {device.entityType === "smart_alarm" && (
                          <>
                            <label>
                              Custom alert message
                              <input
                                value={settingsDraft.alarm?.customMessage ?? ""}
                                onChange={(e) =>
                                  setSettingsDraft({
                                    ...settingsDraft,
                                    alarm: { ...settingsDraft.alarm, customMessage: e.target.value || null },
                                  })
                                }
                              />
                            </label>
                            <label className="checkbox-row">
                              <input
                                type="checkbox"
                                checked={settingsDraft.alarm?.pingEveryone ?? false}
                                onChange={(e) =>
                                  setSettingsDraft({
                                    ...settingsDraft,
                                    alarm: { ...settingsDraft.alarm, pingEveryone: e.target.checked },
                                  })
                                }
                              />
                              Ping @everyone on Discord
                            </label>
                            <DiscordRolePicker
                              selectedIds={settingsDraft.alarm?.pingRoleIds ?? []}
                              onChange={(pingRoleIds) =>
                                setSettingsDraft({
                                  ...settingsDraft,
                                  alarm: { ...settingsDraft.alarm, pingRoleIds },
                                })
                              }
                              label="Ping roles for this alarm"
                              hint="Merged with global role pings from Settings → Smart Alarm."
                            />
                          </>
                        )}
                        <button type="button" onClick={() => void saveSettings(device.id)}>
                          Save settings
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
