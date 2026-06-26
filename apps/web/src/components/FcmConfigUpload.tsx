import { useCallback, useEffect, useState } from "react";
import type { FcmCredentialStatus } from "@rusttools/shared";
import { FCM_CREDENTIAL_LIFETIME_DAYS, FCM_WARNING_DAYS_BEFORE } from "@rusttools/shared";
import { apiFetch, apiUpload } from "../lib/api";

export function FcmConfigUpload() {
  const [status, setStatus] = useState<FcmCredentialStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<FcmCredentialStatus>("/admin/fcm-status");
      setStatus(data);
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Could not load FCM status");
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
      const result = await apiUpload<{ ok: boolean; status: FcmCredentialStatus }>(
        "/admin/fcm-config/upload",
        form,
      );
      setStatus(result.status);
      setMessage("FCM config uploaded and listener restarted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const statusLabel = (() => {
    if (!status?.configured) return "Not configured";
    if (status.expired) return "Expired";
    if (status.warning) return "Expiring soon";
    if (status.listening) return "Listening";
    return "Configured (not listening)";
  })();

  const statusClass = (() => {
    if (!status?.configured || status.expired) return "fcm-status--critical";
    if (status.warning) return "fcm-status--warning";
    if (status.listening) return "fcm-status--ok";
    return "fcm-status--muted";
  })();

  return (
    <section className="settings-section card">
      <h2>FCM credentials (pairing &amp; alarms)</h2>
      <p className="muted">
        Upload your <code>fcm-config.json</code> from{" "}
        <code>npx @liamcottle/rustplus.js fcm-register</code>. Credentials last about{" "}
        {FCM_CREDENTIAL_LIFETIME_DAYS} days; a warning appears in the app when{" "}
        {FCM_WARNING_DAYS_BEFORE} days or fewer remain.
      </p>

      {loading ? (
        <p className="muted">Loading status…</p>
      ) : (
        <>
          {status && (
            <dl className="settings-dl fcm-status-dl">
              <div>
                <dt>Status</dt>
                <dd className={statusClass}>{statusLabel}</dd>
              </div>
              {status.registeredAt && (
                <div>
                  <dt>Registered</dt>
                  <dd>{new Date(status.registeredAt).toLocaleString()}</dd>
                </div>
              )}
              {status.expiresAt && (
                <div>
                  <dt>Expires</dt>
                  <dd className={statusClass}>
                    {new Date(status.expiresAt).toLocaleString()}
                    {status.daysRemaining != null && (
                      <> ({status.daysRemaining} day{status.daysRemaining === 1 ? "" : "s"} left)</>
                    )}
                  </dd>
                </div>
              )}
            </dl>
          )}

          <div className="procgen-upload-actions">
            <label className="btn-secondary procgen-upload-label">
              {uploading ? "Working…" : status?.configured ? "Replace fcm-config.json" : "Upload fcm-config.json"}
              <input
                type="file"
                accept=".json,application/json"
                disabled={uploading}
                hidden
                onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        </>
      )}

      {message && <p className="settings-success">{message}</p>}
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}
