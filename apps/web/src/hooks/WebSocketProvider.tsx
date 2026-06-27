import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "../lib/api";
import { demoTeamChat, demoTeamResponse, isDemoMode } from "../lib/demo";
import { useCan } from "./usePermissions";

const WS_BASE = (import.meta.env.VITE_API_URL ?? "/api").replace(/^http/, "ws");

type WsListener = (event: string, payload: unknown) => void;

interface WebSocketContextValue {
  connected: boolean;
  subscribe: (listener: WsListener) => () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const canView = useCan("view");
  const listenersRef = useRef(new Set<WsListener>());
  const [connected, setConnected] = useState(false);

  const subscribe = useCallback((listener: WsListener) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  useEffect(() => {
    if (!canView) {
      setConnected(false);
      return;
    }

    if (isDemoMode()) {
      setConnected(true);
      const timers = [
        setTimeout(() => {
          const message = {
            steamId: "76561198000000001",
            name: "Teammate One",
            message: "Heading to oil rig now",
            sentAt: Math.floor(Date.now() / 1000),
          };
          demoTeamChat.push(message);
          for (const listener of listenersRef.current) listener("teamChat", message);
        }, 2500),
        setTimeout(() => {
          for (const listener of listenersRef.current) {
            listener("teamChanged", demoTeamResponse);
          }
        }, 4500),
      ];
      return () => {
        setConnected(false);
        timers.forEach(clearTimeout);
      };
    }

    let socket: WebSocket | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const emit = (event: string, payload: unknown) => {
      for (const listener of listenersRef.current) {
        listener(event, payload);
      }
    };

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

      socket.onopen = () => {
        if (!cancelled) setConnected(true);
      };

      socket.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data as string) as { event: string; payload: unknown };
          emit(data.event, data.payload);
        } catch {
          // ignore malformed messages
        }
      };

      socket.onclose = () => {
        setConnected(false);
        if (cancelled) return;
        reconnectTimer = setTimeout(() => {
          void connect();
        }, 5_000);
      };
    };

    void connect();

    return () => {
      cancelled = true;
      setConnected(false);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [canView]);

  const value = useMemo(() => ({ connected, subscribe }), [connected, subscribe]);

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

export function useWebSocketContext(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) {
    throw new Error("useWebSocketContext must be used within WebSocketProvider");
  }
  return ctx;
}

export function useWebSocket(onEvent: (event: string, payload: unknown) => void) {
  const { subscribe } = useWebSocketContext();
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => subscribe((event, payload) => handlerRef.current(event, payload)), [subscribe]);
}

export function useWebSocketConnected(): boolean {
  return useWebSocketContext().connected;
}
