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
  const [disconnecting, setDisconnecting] = useState(false);
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

  const onDisconnect = async () => {
    if (
      !window.confirm(
        "Disconnect Rust+? Live map, team, and device data will be unavailable until you reconnect. Your server pairing in the database is kept.",
      )
    ) {
      return;
    }
    setDisconnecting(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch("/servers/active/rustplus/disconnect", { method: "POST" });
      setMessage("Rust+ disconnected. Use Reconnect Rust+ when you want live data again.");
      notifyActivated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <section className="card">
      <h2>Rust+ connection</h2>
      <p className="muted">
        The bot keeps a 24/7 Rust+ websocket to your server. Disconnect to stop live data without
        removing the server from RustTools. If the socket drops overnight (server restart, network
        blip), use reconnect before re-pairing.
      </p>
      <p>
        Status: <strong>{statusLabel}</strong>
      </p>
      {canAdmin && status === "ok" && (
        <button
          type="button"
          className="btn-secondary"
          disabled={disconnecting}
          onClick={() => void onDisconnect()}
        >
          {disconnecting ? "Disconnecting…" : "Disconnect Rust+"}
        </button>
      )}
      {canAdmin && status !== "ok" && (
        <button
          type="button"
          className="btn-secondary"
          disabled={reconnecting}
          onClick={() => void onReconnect()}
        >
          {reconnecting ? "Reconnecting…" : "Reconnect Rust+"}
        </button>
      )}
      {message && <p className="settings-success">{message}</p>}
      {error && <p className="alert alert-error">{error}</p>}
    </section>
  );
}
