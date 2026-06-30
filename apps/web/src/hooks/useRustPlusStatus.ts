import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { isDemoMode } from "../lib/demo";
import { useActiveServer } from "./useActiveServer";

const POLL_MS = 15_000;

export interface HealthResponse {
  status: string;
  rustplus: { connected: boolean; reconnectPending?: boolean; activeServerId: string | null };
  fcm: { listening: boolean };
}

export function useRustPlusStatus(): {
  status: "ok" | "warn" | "error" | "unknown";
  health: HealthResponse | null;
} {
  const [status, setStatus] = useState<"ok" | "warn" | "error" | "unknown">("unknown");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const { epoch } = useActiveServer();

  useEffect(() => {
    if (isDemoMode()) {
      setStatus("ok");
      setHealth({
        status: "ok",
        rustplus: { connected: true, activeServerId: "demo" },
        fcm: { listening: false },
      });
      return;
    }

    let cancelled = false;

    const refresh = () => {
      void apiFetch<HealthResponse>("/health")
        .then((h) => {
          if (!cancelled) {
            setHealth(h);
            setStatus(h.rustplus.connected ? "ok" : "warn");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setHealth(null);
            setStatus("error");
          }
        });
    };

    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [epoch]);

  return { status, health };
}
