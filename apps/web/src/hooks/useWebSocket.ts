import { useEffect, useRef } from "react";
import { apiFetch } from "../lib/api";

const WS_BASE = (import.meta.env.VITE_API_URL ?? "/api").replace(/^http/, "ws");

export function useWebSocket(onEvent: (event: string, payload: unknown) => void) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let cancelled = false;

    const connect = async () => {
      let wsUrl = `${WS_BASE}/ws`;
      try {
        const { token } = await apiFetch<{ token: string }>("/auth/ws-token");
        wsUrl = `${wsUrl}?token=${encodeURIComponent(token)}`;
      } catch {
        // Same-origin dev proxy may authenticate via cookies alone.
      }

      if (cancelled) return;

      socket = new WebSocket(wsUrl);

      socket.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data as string) as { event: string; payload: unknown };
          handlerRef.current(data.event, data.payload);
        } catch {
          // ignore malformed messages
        }
      };
    };

    void connect();

    return () => {
      cancelled = true;
      socket?.close();
    };
  }, []);
}
