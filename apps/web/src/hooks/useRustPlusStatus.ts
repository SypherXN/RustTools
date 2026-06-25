import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { isDemoMode } from "../lib/demo";
import { useActiveServer } from "./useActiveServer";

const POLL_MS = 15_000;

export function useRustPlusStatus(): "ok" | "warn" | "error" | "unknown" {
  const [status, setStatus] = useState<"ok" | "warn" | "error" | "unknown">("unknown");
  const { epoch } = useActiveServer();

  useEffect(() => {
    if (isDemoMode()) {
      setStatus("ok");
      return;
    }

    let cancelled = false;

    const refresh = () => {
      void apiFetch<{ rustplus: { connected: boolean } }>("/health")
        .then((h) => {
          if (!cancelled) setStatus(h.rustplus.connected ? "ok" : "warn");
        })
        .catch(() => {
          if (!cancelled) setStatus("error");
        });
    };

    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [epoch]);

  return status;
}
