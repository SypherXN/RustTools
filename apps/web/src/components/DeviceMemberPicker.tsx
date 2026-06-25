import { useMemo, useState } from "react";
import { deviceTypeMeta, groupDevicesByType } from "@rusttools/shared";

export interface PickerDevice {
  id: string;
  name: string;
  displayName: string | null;
  entityType: string;
}

function deviceLabel(device: PickerDevice): string {
  return device.displayName ?? device.name;
}

interface DeviceMemberPickerProps {
  devices: PickerDevice[];
  memberEntityIds: string[];
  onMembersChange: (memberEntityIds: string[]) => void | Promise<void>;
  /** Limit which devices can be added (e.g. smart_switch only). */
  entityTypes?: string[];
  readOnly?: boolean;
  addLabel?: string;
  emptyLabel?: string;
}

export function DeviceMemberPicker({
  devices,
  memberEntityIds,
  onMembersChange,
  entityTypes,
  readOnly = false,
  addLabel = "Add device…",
  emptyLabel = "No devices in this folder yet.",
}: DeviceMemberPickerProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);

  const pool = useMemo(() => {
    if (!entityTypes?.length) return devices;
    const allowed = new Set(entityTypes);
    return devices.filter((d) => allowed.has(d.entityType));
  }, [devices, entityTypes]);

  const members = useMemo(
    () =>
      memberEntityIds
        .map((id) => pool.find((d) => d.id === id) ?? devices.find((d) => d.id === id))
        .filter((d): d is PickerDevice => d != null),
    [memberEntityIds, pool, devices],
  );

  const available = useMemo(() => {
    const memberSet = new Set(memberEntityIds);
    const q = filter.trim().toLowerCase();
    return pool.filter((d) => {
      if (memberSet.has(d.id)) return false;
      if (!q) return true;
      const label = deviceLabel(d).toLowerCase();
      const meta = deviceTypeMeta(d.entityType);
      return (
        label.includes(q) ||
        d.name.toLowerCase().includes(q) ||
        d.entityType.includes(q) ||
        meta?.title.toLowerCase().includes(q)
      );
    });
  }, [pool, memberEntityIds, filter]);

  const groupedAvailable = useMemo(() => groupDevicesByType(available), [available]);

  const applyChange = async (next: string[]) => {
    setSaving(true);
    try {
      await onMembersChange(next);
    } finally {
      setSaving(false);
    }
  };

  const addDevice = async (deviceId: string) => {
    if (memberEntityIds.includes(deviceId)) return;
    await applyChange([...memberEntityIds, deviceId]);
  };

  const removeDevice = async (deviceId: string) => {
    await applyChange(memberEntityIds.filter((id) => id !== deviceId));
  };

  const closePicker = () => {
    setPickerOpen(false);
    setFilter("");
  };

  return (
    <div className="device-member-picker">
      {members.length === 0 && <p className="muted device-member-picker-empty">{emptyLabel}</p>}
      {members.length > 0 && (
        <ul className="device-member-grid">
          {members.map((device) => {
            const meta = deviceTypeMeta(device.entityType);
            return (
              <li key={device.id} className="device-member-chip">
                <img
                  className="device-member-chip-icon"
                  src={meta?.iconUrl}
                  alt=""
                  title={meta?.inGameItem}
                />
                <div className="device-member-chip-text">
                  <span className="device-member-chip-name">{deviceLabel(device)}</span>
                  <span className="device-member-chip-type">{meta?.inGameItem ?? device.entityType}</span>
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    className="device-member-chip-remove"
                    aria-label={`Remove ${deviceLabel(device)}`}
                    disabled={saving}
                    onClick={() => void removeDevice(device.id)}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && (
        <button
          type="button"
          className="btn-secondary device-member-add-btn"
          disabled={saving || pool.length === memberEntityIds.length}
          onClick={() => setPickerOpen(true)}
        >
          {addLabel}
        </button>
      )}

      {pickerOpen && (
        <div className="storage-icon-picker-backdrop" onClick={closePicker}>
          <div
            className="storage-icon-picker device-member-picker-dialog card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Add device"
          >
            <header className="storage-icon-picker-header">
              <h3>Add device</h3>
              <button type="button" className="link-btn" onClick={closePicker}>
                Done
              </button>
            </header>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search by name or type…"
              className="storage-icon-picker-filter"
              autoFocus
            />
            <div className="device-member-picker-scroll">
              {groupedAvailable.length === 0 && (
                <p className="muted">No devices available to add.</p>
              )}
              {groupedAvailable.map(({ meta, devices: sectionDevices }) => (
                <section key={meta.type} className="device-member-picker-section">
                  <header className="device-type-header">
                    <img className="device-type-icon" src={meta.iconUrl} alt="" />
                    <h4>{meta.title}</h4>
                  </header>
                  <div className="storage-icon-picker-grid">
                    {sectionDevices.map((device) => (
                      <button
                        key={device.id}
                        type="button"
                        className="storage-icon-picker-option"
                        title={deviceLabel(device)}
                        disabled={saving}
                        onClick={() => void addDevice(device.id)}
                      >
                        <img src={meta.iconUrl} alt="" />
                        <span>{deviceLabel(device)}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
