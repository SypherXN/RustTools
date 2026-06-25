import { useCallback, useEffect, useState } from "react";
import type { ProcgenMapStatus } from "@rusttools/shared";
import { apiFetch, apiUpload } from "../lib/api";

export function ProcgenMapUpload() {
  const [status, setStatus] = useState<ProcgenMapStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<ProcgenMapStatus>("/servers/active/map/procgen/status");
      setStatus(data);
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Could not load procgen map status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onUpload = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      await apiUpload<{ ok: boolean }>("/servers/active/map/procgen/upload", form);
      setMessage("Map uploaded and parsed successfully.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async () => {
    if (!window.confirm("Remove the uploaded .map file and all derived overlays?")) return;
    setUploading(true);
    setError(null);
    try {
      await apiFetch("/servers/active/map/procgen", { method: "DELETE" });
      setMessage("Procgen map data removed.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="settings-section card">
      <h2>Procgen map file (.map)</h2>
      <p className="muted">
        Upload the server&apos;s <code>.map</code> file (from your Rust client cache after joining, or F1{" "}
        <code>Download map file</code>) to unlock building-blocked zones, resource heatmaps, roads, caves, and the 3D
        map view.
      </p>

      {loading ? (
        <p className="muted">Loading status…</p>
      ) : (
        <>
          {status && (
            <dl className="settings-dl procgen-status-dl">
              <div>
                <dt>Status</dt>
                <dd>{status.parseStatus ?? (status.uploaded ? "uploaded" : "not uploaded")}</dd>
              </div>
              {status.parsedAt && (
                <div>
                  <dt>Parsed</dt>
                  <dd>{new Date(status.parsedAt).toLocaleString()}</dd>
                </div>
              )}
              {status.mapWorldSize != null && (
                <div>
                  <dt>Map world size</dt>
                  <dd>{status.mapWorldSize}m</dd>
                </div>
              )}
              {status.sizeMatch === false && (
                <div className="procgen-warn">
                  <dt>Size mismatch</dt>
                  <dd>
                    Uploaded map ({status.mapWorldSize}m) does not match active server ({status.serverMapSize}m).
                  </dd>
                </div>
              )}
              {status.parseError && (
                <div className="procgen-error">
                  <dt>Parse error</dt>
                  <dd>{status.parseError}</dd>
                </div>
              )}
            </dl>
          )}

          <div className="procgen-upload-actions">
            <label className="btn-secondary procgen-upload-label">
              {uploading ? "Working…" : status?.parseStatus === "ready" ? "Replace .map file" : "Upload .map file"}
              <input
                type="file"
                accept=".map"
                disabled={uploading}
                hidden
                onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
              />
            </label>
            {status?.uploaded && (
              <button type="button" className="btn-secondary" disabled={uploading} onClick={() => void onDelete()}>
                Remove
              </button>
            )}
          </div>
        </>
      )}

      {message && <p className="settings-success">{message}</p>}
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}
