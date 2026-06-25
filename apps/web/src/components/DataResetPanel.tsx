import { useState } from "react";
import { apiFetch } from "../lib/api";
import { DATA_RESET_SCOPE_LABELS, type DataResetScope } from "@rusttools/shared";

const RESET_SCOPES = Object.keys(DATA_RESET_SCOPE_LABELS) as DataResetScope[];

export function DataResetPanel({ disabled }: { disabled: boolean }) {
  const [busyScope, setBusyScope] = useState<DataResetScope | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runReset = async (scope: DataResetScope) => {
    const label = DATA_RESET_SCOPE_LABELS[scope];
    if (!window.confirm(`Reset "${label}"? This cannot be undone.`)) return;

    setBusyScope(scope);
    setMessage(null);
    setError(null);
    try {
      const result = await apiFetch<{ detail: string }>("/admin/data-reset", {
        method: "POST",
        body: JSON.stringify({ scope }),
      });
      setMessage(result.detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setBusyScope(null);
    }
  };

  return (
    <div>
      <p className="muted">
        Selective resets for the active server (unless noted). Destructive — use with care.
      </p>
      <ul className="setup-steps">
        {RESET_SCOPES.map((scope) => (
          <li key={scope}>
            <strong>{DATA_RESET_SCOPE_LABELS[scope]}</strong>{" "}
            <button
              type="button"
              className="btn-secondary"
              disabled={disabled || busyScope !== null}
              onClick={() => void runReset(scope)}
            >
              {busyScope === scope ? "Resetting…" : "Reset"}
            </button>
          </li>
        ))}
      </ul>
      {message && <p className="success-text">{message}</p>}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
