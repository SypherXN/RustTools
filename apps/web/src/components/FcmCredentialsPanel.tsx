import { useCallback, useEffect, useState } from "react";
import type { FcmCredentialSummary } from "@rusttools/shared";
import { FCM_CREDENTIAL_LIFETIME_DAYS, FCM_WARNING_DAYS_BEFORE } from "@rusttools/shared";
import { apiFetch, apiUpload } from "../lib/api";
import { invalidateApiCache } from "../lib/api-cache";
import { invalidateFcmStatusCache, useFcmStatus } from "../hooks/useFcmStatus";

const HELPER_REGISTER_CMD = "dotnet run --project tools/rustplus-register";
const HELPER_RENEW_CMD =
  'dotnet run --project tools/rustplus-register -- --credentials "C:\\Private Folder\\existing-config.json"';

function statusClass(row: FcmCredentialSummary): string {
  if (!row.isActive && !row.expired) return "fcm-status--muted";
  if (row.expired) return "fcm-status--critical";
  if (row.warning) return "fcm-status--warning";
  if (row.isActive && row.listening) return "fcm-status--ok";
  return "fcm-status--muted";
}

function statusLabel(row: FcmCredentialSummary): string {
  if (row.expired) return "Push registration expired";
  if (row.isActive && row.listening) return "Push active · listening";
  if (row.isActive) return "Push active · not listening";
  if (row.warning) return "Push expiring soon";
  return "Push standby";
}

/** Separate 14-day Rust+ relay login (Facepunch companion auth) per slot. */
function companionState(row: FcmCredentialSummary): { label: string; cls: string; needsRenew: boolean } {
  const companion = row.companion;
  if (!companion || !companion.configured) {
    return { label: "Not set up — push only", cls: "fcm-status--muted", needsRenew: false };
  }
  if (companion.expired) return { label: "Expired — renew", cls: "fcm-status--critical", needsRenew: true };
  if (companion.warning) return { label: "Expiring soon — renew", cls: "fcm-status--warning", needsRenew: true };
  if (companion.daysRemaining != null) {
    return {
      label: `Active · ${companion.daysRemaining} day${companion.daysRemaining === 1 ? "" : "s"} left`,
      cls: "fcm-status--ok",
      needsRenew: false,
    };
  }
  return { label: "Active", cls: "fcm-status--ok", needsRenew: false };
}

export function FcmCredentialsPanel() {
  const activeStatus = useFcmStatus(true);
  const [credentials, setCredentials] = useState<FcmCredentialSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ credentials: FcmCredentialSummary[] }>("/admin/fcm-credentials");
      setCredentials(res.credentials);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load FCM credentials");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const afterMutation = () => {
    invalidateFcmStatusCache();
    invalidateApiCache();
    void load();
  };

  const onAdd = async (file: File | null) => {
    if (!file) return;
    setBusyId("new");
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const label = newLabel.trim();
      const path = label
        ? `/admin/fcm-credentials?label=${encodeURIComponent(label)}`
        : "/admin/fcm-credentials";
      await apiUpload(path, form);
      setNewLabel("");
      setMessage("FCM credential added.");
      afterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusyId(null);
    }
  };

  const onReplace = async (id: string, file: File | null) => {
    if (!file) return;
    setBusyId(id);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      await apiUpload(`/admin/fcm-credentials/${id}/replace`, form);
      setMessage("FCM credentials renewed.");
      afterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replace failed");
    } finally {
      setBusyId(null);
    }
  };

  const onActivate = async (id: string) => {
    setBusyId(id);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(`/admin/fcm-credentials/${id}/activate`, { method: "POST" });
      setMessage("Switched active master account.");
      afterMutation();
      window.dispatchEvent(new CustomEvent("rusttools:active-server-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Activate failed");
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (row: FcmCredentialSummary) => {
    const serversNote =
      row.serverCount > 0
        ? ` This removes ${row.serverCount} paired server(s) and all related devices, map data, and settings for this master.`
        : "";
    if (
      !window.confirm(
        `Delete FCM "${row.label}"?${serversNote} This cannot be undone.`,
      )
    ) {
      return;
    }

    setBusyId(row.id);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(`/admin/fcm-credentials/${row.id}`, { method: "DELETE" });
      setMessage(`Deleted FCM "${row.label}".`);
      afterMutation();
      window.dispatchEvent(new CustomEvent("rusttools:active-server-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  };

  const onRename = async (id: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setBusyId(id);
    try {
      await apiFetch(`/admin/fcm-credentials/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ label: trimmed }),
      });
      afterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setBusyId(null);
    }
  };

  const copyCommand = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(cmd);
    } catch {
      setError("Could not copy — select the command and copy manually.");
    }
  };

  const hasHealthyActive = credentials.some(
    (row) => row.isActive && !row.expired && !row.warning,
  );

  return (
    <section className="settings-section card">
      <h2>FCM master accounts</h2>
      <p className="muted">
        Each FCM slot is a separate Rust+ master bot (Steam account). Pairing, devices, map
        overlays, and notification settings are kept per slot — switch masters without losing the
        other account&apos;s setup. Push registration lasts about {FCM_CREDENTIAL_LIFETIME_DAYS}
        days; the separate Rust+ relay login lasts 14 days.
      </p>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : credentials.length === 0 ? (
        <div className="fcm-wizard">
          <p className="fcm-wizard-callout">
            No FCM credentials yet — pairing and in-game alarms will not work until you add one.
            The Rust+ relay login (Facepunch auth) is part of the same private file; a legacy
            push-only file still works for alarms, but relay needs the Rust+ login.
          </p>
          <ol className="setup-steps fcm-wizard-steps">
            <li>
              <strong>Register with the RustTools helper (Windows)</strong>
              <p className="muted fcm-wizard-note">
                Requires the .NET 10 SDK and Edge or Chrome. Run the command below, sign in with the
                Steam account that will be this master bot. The helper exports the file and exits;
                it does not wait for server pairing. The
                helper writes one private combined auth file (push registration + Rust+ login) to
                your private folder — <code>%LOCALAPPDATA%\RustTools</code> when you omit
                <code> --output</code>. Keep the file private; never paste its contents into chat.
              </p>
              <div className="fcm-command-block">
                <code className="fcm-command-block__cmd">{HELPER_REGISTER_CMD}</code>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void copyCommand(HELPER_REGISTER_CMD)}
                >
                  {copied === HELPER_REGISTER_CMD ? "Copied!" : "Copy command"}
                </button>
              </div>
            </li>
            <li>
              <strong>Add master slot</strong>
              <div className="fcm-add-row">
                <input
                  type="text"
                  className="input"
                  placeholder="Label (e.g. Matt's bot)"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
                <label className="btn-secondary procgen-upload-label">
                  {busyId === "new" ? "Uploading…" : "Upload combined auth file"}
                  <input
                    type="file"
                    accept=".json,application/json"
                    disabled={busyId === "new"}
                    hidden
                    onChange={(e) => void onAdd(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            </li>
          </ol>
        </div>
      ) : (
        <>
          <div className="fcm-credential-list">
            {credentials.map((row) => (
              <article
                key={row.id}
                className={`fcm-credential-card${row.isActive ? " fcm-credential-card--active" : ""}`}
              >
                <header className="fcm-credential-card__header">
                  <div>
                    <h3 className="fcm-credential-card__title">
                      {row.label}
                      {row.isActive && <span className="badge badge-ok">Active</span>}
                    </h3>
                    <p className={`muted fcm-credential-card__status ${statusClass(row)}`}>
                      {statusLabel(row)}
                      {" · "}
                      {row.daysRemaining} day{row.daysRemaining === 1 ? "" : "s"} left
                    </p>
                  </div>
                  <div className="btn-row fcm-credential-card__actions">
                    {!row.isActive && (
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={busyId != null || row.expired}
                        onClick={() => void onActivate(row.id)}
                      >
                        {busyId === row.id ? "Switching…" : "Use this master"}
                      </button>
                    )}
                    <label className="btn-secondary procgen-upload-label">
                      {busyId === row.id ? "Working…" : "Renew"}
                      <input
                        type="file"
                        accept=".json,application/json"
                        disabled={busyId != null}
                        hidden
                        onChange={(e) => void onReplace(row.id, e.target.files?.[0] ?? null)}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={busyId != null}
                      onClick={() => void onDelete(row)}
                    >
                      Delete
                    </button>
                  </div>
                </header>

                <dl className="settings-dl fcm-status-dl">
                  <div>
                    <dt>Expires</dt>
                    <dd className={statusClass(row)}>
                      {new Date(row.expiresAt).toLocaleString()} ({row.daysRemaining}d)
                    </dd>
                  </div>
                  <div>
                    <dt>Paired servers</dt>
                    <dd>
                      {row.serverCount}
                      {row.activeServerName ? ` · active: ${row.activeServerName}` : ""}
                    </dd>
                  </div>
                  {row.masterPlayerId && (
                    <div>
                      <dt>Master Steam ID</dt>
                      <dd>
                        <code>{row.masterPlayerId}</code>
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Rust+ login (14 d)</dt>
                    <dd className={companionState(row).cls}>{companionState(row).label}</dd>
                  </div>
                </dl>

                {(companionState(row).needsRenew || !row.companion?.configured) && row.isActive && (
                  <p className="muted fcm-credential-note">
                    {companionState(row).needsRenew
                      ? `Push registration is ${row.listening ? "listening fine" : "active"}, but the Rust+ relay login ${row.companion?.expired ? "has expired" : "expires soon"} — relay features stop when it does. Renew: run the helper with --credentials on the private file from this slot, then upload it with Renew below.`
                      : "This slot only has push registration. The Rust+ relay login needs Facepunch auth — register with the helper and upload the combined file with Renew."}
                  </p>
                )}
                <p className="muted fcm-credential-note">
                  For normal renewal, use Renew rather than Delete: it replaces this slot's file
                  while keeping paired servers. The clocks are independent: a fresh Steam login
                  lasts 14 days; reusing push credentials preserves their original ~90-day clock.
                  Only a new push registration starts a new push clock.{" "}
                  {row.companion?.expiresAt && row.companion?.configured
                    ? `Rust+ login expires ${new Date(row.companion.expiresAt).toLocaleDateString()}.`
                    : null}
                </p>

                <div className="fcm-rename-row">
                  <input
                    type="text"
                    className="input input-sm"
                    defaultValue={row.label}
                    disabled={busyId != null}
                    onBlur={(e) => {
                      if (e.target.value.trim() !== row.label) {
                        void onRename(row.id, e.target.value);
                      }
                    }}
                  />
                </div>
              </article>
            ))}
          </div>

          <details className="fcm-renew-details">
            <summary>Add another master account or renew an existing one</summary>
            <div className="fcm-wizard fcm-wizard--nested">
              <p className="muted fcm-wizard-note">
                The helper (Windows, .NET 10 SDK + Edge or Chrome) writes one private combined auth
                file per Steam account — push registration (~90 days) plus the Rust+ relay login
                (14 days). Keep the file private; never paste its contents into chat. Push
                warning at {FCM_WARNING_DAYS_BEFORE} days; expired push slots and
                their server data are removed automatically.
              </p>
              <div className="fcm-command-block">
                <code className="fcm-command-block__cmd">{HELPER_REGISTER_CMD}</code>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void copyCommand(HELPER_REGISTER_CMD)}
                >
                  {copied === HELPER_REGISTER_CMD ? "Copied!" : "Copy command"}
                </button>
              </div>
              <div className="fcm-command-block">
                <code className="fcm-command-block__cmd">{HELPER_RENEW_CMD}</code>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void copyCommand(HELPER_RENEW_CMD)}
                >
                  {copied === HELPER_RENEW_CMD ? "Copied!" : "Copy command"}
                </button>
              </div>
              <p className="muted fcm-wizard-note">
                New slot: the first command writes to the private folder by default; upload below
                with a label. <strong>Renew:</strong> replace the quoted example path in the second
                command with your existing private file's full path (keep the quotes for spaces).
                Upload the freshly exported combined file using the existing slot's Renew button
                to preserve its paired servers. Reusing push credentials keeps their original
                expiry; a fresh Steam login starts its own 14-day clock.
              </p>
              <div className="fcm-add-row">
                <input
                  type="text"
                  className="input"
                  placeholder="Label for new master"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
                <label className="btn-secondary procgen-upload-label">
                  {busyId === "new" ? "Uploading…" : "Upload combined auth file"}
                  <input
                    type="file"
                    accept=".json,application/json"
                    disabled={busyId === "new"}
                    hidden
                    onChange={(e) => void onAdd(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            </div>
          </details>

          {!hasHealthyActive && activeStatus && (
            <p className="settings-error fcm-wizard-callout">
              {activeStatus.expired
                ? "Active push registration has expired — renew or switch to another master."
                : "Active FCM needs attention — renew soon or switch master."}
              {activeStatus.companion?.expired &&
                " The Rust+ relay login has also expired — relay features need a fresh helper file."}
            </p>
          )}
        </>
      )}

      {message && <p className="settings-success">{message}</p>}
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}
