import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { isDemoMode } from "../lib/demo";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export function PushNotificationSetup({ disabled }: { disabled?: boolean }) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(
      !isDemoMode() &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        typeof Notification !== "undefined",
    );
  }, []);

  const enable = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setError("Notification permission denied");
        return;
      }

      const { publicKey, configured } = await apiFetch<{ publicKey: string | null; configured: boolean }>(
        "/push/vapid-public-key",
      );
      if (!configured || !publicKey) {
        setError("Server push is not configured (set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY on API).");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      await apiFetch("/push/subscribe", {
        method: "POST",
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });

      setStatus("Push notifications enabled for this browser.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable push");
    } finally {
      setBusy(false);
    }
  };

  if (!supported) {
    return <p className="muted">Push notifications are not supported in this browser.</p>;
  }

  return (
    <div>
      <p className="muted">
        Enable background raid alerts on mobile/desktop when the PWA is installed or the tab is closed
        (requires VAPID keys on the API).
      </p>
      <button type="button" className="btn-secondary" disabled={disabled || busy} onClick={() => void enable()}>
        {busy ? "Enabling…" : "Enable push notifications"}
      </button>
      {status && <p className="success-text">{status}</p>}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
