import { useEffect, useRef } from "react";
import type { TeamChatMessage } from "@rusttools/shared";
import { apiFetch } from "../lib/api";
import { demoTeamChat, demoTeamDeaths, demoTeamInfo, demoTeamResponse, isDemoMode } from "../lib/demo";
import { useCan } from "./usePermissions";

const WS_BASE = (import.meta.env.VITE_API_URL ?? "/api").replace(/^http/, "ws");

export function useWebSocket(onEvent: (event: string, payload: unknown) => void) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const canView = useCan("view");

  useEffect(() => {
    if (!canView) return;
    if (isDemoMode()) {
      const timers = [
        setTimeout(() => {
          const message: TeamChatMessage = {
            steamId: "76561198000000001",
            name: "Teammate One",
            message: "Heading to oil rig now",
            sentAt: Math.floor(Date.now() / 1000),
          };
          demoTeamChat.push(message);
          handlerRef.current("teamChat", message);
        }, 2500),
        setTimeout(() => {
          handlerRef.current("teamChanged", {
            ...demoTeamResponse,
            team: {
              ...demoTeamInfo,
              members: demoTeamInfo.members.map((m) =>
                m.steamId === "76561198000000001"
                  ? {
                      ...m,
                      isAlive: true,
                      status: "online" as const,
                      x: 1120,
                      y: 1000,
                      spawnTime: Math.floor(Date.now() / 1000) - 120,
                      deathTime: null,
                      afkSince: null,
                    }
                  : m,
              ),
            },
          });
        }, 4500),
        setTimeout(() => {
          const deathTime = Math.floor(Date.now() / 1000) - 30;
          handlerRef.current("teamChanged", {
            ...demoTeamResponse,
            team: {
              ...demoTeamInfo,
              members: demoTeamInfo.members.map((m) =>
                m.steamId === "76561198000000004"
                  ? {
                      ...m,
                      isOnline: true,
                      isAlive: false,
                      status: "dead" as const,
                      deathTime,
                      afkSince: null,
                    }
                  : m,
              ),
            },
            deaths: [
              {
                steamId: "76561198000000004",
                name: "Teammate Four",
                deathTime,
                grid: "G6",
                x: 1000,
                y: 1000,
              },
              ...demoTeamDeaths,
            ],
          });
        }, 8000),
        setTimeout(() => {
          handlerRef.current("entityChanged", { entityId: 10001 });
        }, 6000),
        setTimeout(() => {
          handlerRef.current("storageChanged", { name: "Main TC" });
        }, 9000),
      ];
      return () => timers.forEach(clearTimeout);
    }

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
  }, [canView]);
}
