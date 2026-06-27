import { useEffect, useState } from "react";
import type { FcmCredentialStatus } from "@rusttools/shared";
import { FCM_CREDENTIAL_LIFETIME_DAYS, FCM_WARNING_DAYS_BEFORE } from "@rusttools/shared";
import { apiUpload } from "../lib/api";
import { invalidateFcmStatusCache, useFcmStatus } from "../hooks/useFcmStatus";

const FCM_REGISTER_CMD =
  "npx @liamcottle/rustplus.js fcm-register --config-file=./data/fcm-config.json";

function fcmHealthy(status: FcmCredentialStatus | null): boolean {
  return Boolean(status?.configured && status.listening && !status.warning && !status.expired);
}

export function FcmConfigUpload() {
  const sharedStatus = useFcmStatus(true);
  const [status, setStatus] = useState<FcmCredentialStatus | null>(sharedStatus);
  const [loading, setLoading] = useState(sharedStatus == null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (sharedStatus) {
      setStatus(sharedStatus);
      setLoading(false);
    }
  }, [sharedStatus]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

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
      invalidateFcmStatusCache();
      setStatus(result.status);
      setMessage("FCM config uploaded and listener restarted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(FCM_REGISTER_CMD);
      setCopied(true);
    } catch {
      setError("Could not copy — select the command and copy manually.");
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

  const healthy = fcmHealthy(status);
  const showWizard = !healthy;

  const uploadButton = (
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
  );

  const registerStep = (
    <>
      <p className="muted fcm-wizard-note">
        Run once on a machine with <strong>Google Chrome</strong> (Windows, Mac, or Linux). Chrome
        opens automatically so you can sign in with Steam and link Rust+. The command writes{" "}
        <code>data/fcm-config.json</code> in your RustTools folder (or repo root in dev).
      </p>
      <div className="fcm-command-block">
        <code className="fcm-command-block__cmd">{FCM_REGISTER_CMD}</code>
        <button type="button" className="btn-secondary" onClick={() => void copyCommand()}>
          {copied ? "Copied!" : "Copy command"}
        </button>
      </div>
    </>
  );

  const wizardSteps = (
    <ol className="setup-steps fcm-wizard-steps">
      <li>
        <strong>Register FCM credentials</strong>
        {registerStep}
      </li>
      <li>
        <strong>Upload to RustTools</strong>
        <p className="muted fcm-wizard-note">
          Choose the <code>fcm-config.json</code> file from step 1. The API saves it and restarts
          the pairing listener — no server restart needed.
        </p>
        <div className="procgen-upload-actions">{uploadButton}</div>
      </li>
      <li>
        <strong>Link your Rust+ account</strong>
        <p className="muted fcm-wizard-note">
          Open the <strong>Server</strong> tab → click <strong>Link Rust+ Account</strong> (or{" "}
          <strong>Re-pair Server</strong> if reconnecting). This tells RustTools to capture your
          Steam ID on the next in-game pair.
        </p>
      </li>
      <li>
        <strong>Pair in Rust</strong>
        <p className="muted fcm-wizard-note">
          In-game: Rust+ menu → <strong>Pair with Server</strong>. Pair smart switches, alarms, and
          storage monitors with the wire tool. New devices appear on the Devices page automatically.
        </p>
      </li>
    </ol>
  );

  return (
    <section className="settings-section card">
      <h2>FCM credentials (pairing &amp; alarms)</h2>
      <p className="muted">
        FCM lets RustTools receive server and device pairing from the game, plus smart-alarm
        triggers. Credentials last about {FCM_CREDENTIAL_LIFETIME_DAYS} days — renew before they
        expire (warning at {FCM_WARNING_DAYS_BEFORE} days).
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

          {showWizard ? (
            <div className="fcm-wizard">
              <h3 className="fcm-wizard-title">
                {!status?.configured
                  ? "Setup wizard"
                  : status.expired
                    ? "Credentials expired — renew"
                    : "Renew before expiry"}
              </h3>
              {!status?.configured && (
                <p className="fcm-wizard-callout">
                  Pairing and in-game alarms will not work until FCM is configured.
                </p>
              )}
              {wizardSteps}
            </div>
          ) : (
            <>
              <p className="settings-success fcm-wizard-ok">
                FCM is active — pairing and alarm pushes are enabled.
              </p>
              <details className="fcm-renew-details">
                <summary>Renew credentials (every ~{FCM_CREDENTIAL_LIFETIME_DAYS} days)</summary>
                <div className="fcm-wizard fcm-wizard--nested">
                  <ol className="setup-steps fcm-wizard-steps">
                    <li>
                      <strong>Re-run registration</strong>
                      {registerStep}
                    </li>
                    <li>
                      <strong>Upload the new file</strong>
                      <div className="procgen-upload-actions">{uploadButton}</div>
                    </li>
                  </ol>
                </div>
              </details>
            </>
          )}
        </>
      )}

      {message && <p className="settings-success">{message}</p>}
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}
