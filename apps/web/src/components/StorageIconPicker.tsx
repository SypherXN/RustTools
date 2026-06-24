import { useMemo, useState } from "react";
import type { StorageContainerIconOption, StorageContainerKind } from "@rusttools/shared";
import { iconOptionsForKind } from "@rusttools/shared";

interface StorageIconPickerProps {
  kind: StorageContainerKind;
  currentShortname: string;
  autoDetected: boolean;
  onSave: (shortname: string | null) => Promise<void>;
  onClose: () => void;
}

export function StorageIconPicker({
  kind,
  currentShortname,
  autoDetected,
  onSave,
  onClose,
}: StorageIconPickerProps) {
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);

  const options = useMemo(() => iconOptionsForKind(kind), [kind]);
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (opt) => opt.name.toLowerCase().includes(q) || opt.shortname.toLowerCase().includes(q),
    );
  }, [filter, options]);

  const pick = async (opt: StorageContainerIconOption) => {
    setSaving(true);
    try {
      await onSave(opt.shortname);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      await onSave(null);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="storage-icon-picker-backdrop" onClick={onClose}>
      <div
        className="storage-icon-picker card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Choose container icon"
      >
        <header className="storage-icon-picker-header">
          <h3>Choose icon</h3>
          <button type="button" className="link-btn" onClick={onClose}>
            Close
          </button>
        </header>
        {autoDetected && (
          <p className="muted storage-icon-picker-hint">
            Auto-detected from Rust+. Pick a skin if this monitor is on a different container.
          </p>
        )}
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter icons..."
          className="storage-icon-picker-filter"
        />
        <div className="storage-icon-picker-grid">
          {filtered.map((opt) => (
            <button
              key={opt.shortname}
              type="button"
              className={`storage-icon-picker-option${opt.shortname === currentShortname ? " active" : ""}`}
              title={opt.name}
              disabled={saving}
              onClick={() => void pick(opt)}
            >
              <img src={opt.iconUrl} alt="" />
              <span>{opt.name}</span>
            </button>
          ))}
        </div>
        {filtered.length === 0 && <p className="muted">No icons match.</p>}
        <div className="storage-icon-picker-actions">
          <button type="button" onClick={() => void reset()} disabled={saving}>
            Reset to auto
          </button>
        </div>
      </div>
    </div>
  );
}
