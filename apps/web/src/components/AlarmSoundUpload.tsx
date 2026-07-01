import { useCallback, useEffect, useState } from "react";
import {
  deleteAlarmSound,
  fetchAlarmSoundStatus,
  invalidateAlarmSoundCache,
  playAlarmSound,
  prefetchCustomAlarmSound,
  uploadAlarmSound,
  type AlarmSoundStatus,
} from "../lib/alarm-sound";
import { useActiveServer } from "../hooks/useActiveServer";

export function AlarmSoundUpload({
  disabled,
  onCapabilitiesChange,
}: {
  disabled?: boolean;
  onCapabilitiesChange?: (configured: boolean) => void;
}) {
  const { epoch } = useActiveServer();
  const [status, setStatus] = useState<AlarmSoundStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchAlarmSoundStatus();
      setStatus(next);
      setError(null);
      onCapabilitiesChange?.(next.configured);
      if (next.configured) {
        await prefetchCustomAlarmSound(epoch);
      } else {
        invalidateAlarmSoundCache();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alarm sound status");
    } finally {
      setLoading(false);
    }
  }, [epoch, onCapabilitiesChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const onUpload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await uploadAlarmSound(file);
      setStatus(result.status);
      onCapabilitiesChange?.(true);
      invalidateAlarmSoundCache();
      await prefetchCustomAlarmSound(epoch);
      setMessage("Custom alarm sound uploaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    if (!window.confirm("Remove the custom alarm sound and use the default siren?")) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await deleteAlarmSound();
      setStatus({ configured: false, originalName: null, mimeType: null, uploadedAt: null });
      onCapabilitiesChange?.(false);
      setMessage("Custom alarm sound removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    setError(null);
    try {
      await playAlarmSound({
        browserSiren: true,
        customAlarmSound: status?.configured ?? false,
        epoch,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not play sound");
    }
  };

  return (
    <div className="form-subsection alarm-sound-upload">
      <h3>Custom browser alarm sound</h3>
      <p className="muted">
        When a smart alarm fires and this tab is open, RustTools plays your uploaded sound instead
        of the built-in siren. MP3, WAV, OGG, or WebM — max 2 MB. Discord and push notifications
        are unchanged.
      </p>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {status?.configured ? (
            <p className="settings-success">
              Using <strong>{status.originalName}</strong>
              {status.uploadedAt ? (
                <> · uploaded {new Date(status.uploadedAt).toLocaleString()}</>
              ) : null}
            </p>
          ) : (
            <p className="muted">No custom sound — the default siren is used.</p>
          )}

          <div className="btn-row">
            <label className="btn-secondary procgen-upload-label">
              {busy ? "Working…" : status?.configured ? "Replace sound" : "Upload sound"}
              <input
                type="file"
                accept=".mp3,.wav,.ogg,.webm,audio/mpeg,audio/wav,audio/ogg,audio/webm"
                disabled={disabled || busy}
                hidden
                onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
              />
            </label>
            <button
              type="button"
              className="btn-secondary"
              disabled={disabled || busy}
              onClick={() => void onTest()}
            >
              Test sound
            </button>
            {status?.configured && (
              <button
                type="button"
                className="btn-danger"
                disabled={disabled || busy}
                onClick={() => void onRemove()}
              >
                Remove
              </button>
            )}
          </div>
        </>
      )}

      {message && <p className="settings-success">{message}</p>}
      {error && <p className="settings-error">{error}</p>}
    </div>
  );
}
