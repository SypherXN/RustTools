import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
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
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => iconOptionsForKind(kind), [kind]);
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (opt) => opt.name.toLowerCase().includes(q) || opt.shortname.toLowerCase().includes(q),
    );
  }, [filter, options]);

  const pick = async (opt: StorageContainerIconOption) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(opt.shortname);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save icon");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset icon");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="storage-icon-picker-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
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
        {error && <p className="alert alert-error">{error}</p>}
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
              <img src={opt.iconUrl} alt="" draggable={false} />
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
    </div>,
    document.body,
  );
}
