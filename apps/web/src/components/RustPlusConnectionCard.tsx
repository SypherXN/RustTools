import { useState } from "react";
import { apiFetch } from "../lib/api";
import { useRustPlusStatus } from "../hooks/useRustPlusStatus";
import { useCan } from "../hooks/usePermissions";
import { useActiveServer } from "../hooks/useActiveServer";

export function RustPlusConnectionCard() {
  const canAdmin = useCan("admin");
  const { status, health } = useRustPlusStatus();
  const { notifyActivated } = useActiveServer();
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const statusLabel =
    status === "ok"
      ? "Connected"
      : status === "warn"
        ? health?.rustplus.reconnectPending
          ? "Reconnecting…"
          : "Disconnected"
        : status === "error"
          ? "API unreachable"
          : "Checking…";

  const onReconnect = async () => {
    setReconnecting(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch("/servers/active/rustplus/reconnect", { method: "POST" });
      setMessage("Rust+ reconnect requested. Give it a few seconds, then refresh the page.");
      notifyActivated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reconnect failed");
    } finally {
      setReconnecting(false);
    }
  };

  return (
    <section className="card">
      <h2>Rust+ connection</h2>
      <p className="muted">
        The bot keeps a 24/7 Rust+ websocket to your server. If it drops overnight (server restart,
        network blip), use reconnect here before re-pairing.
      </p>
      <p>
        Status: <strong>{statusLabel}</strong>
      </p>
      {canAdmin && status !== "ok" && (
        <button type="button" className="btn-secondary" disabled={reconnecting} onClick={() => void onReconnect()}>
          {reconnecting ? "Reconnecting…" : "Reconnect Rust+"}
        </button>
      )}
      {message && <p className="settings-success">{message}</p>}
      {error && <p className="alert alert-error">{error}</p>}
    </section>
  );
}
