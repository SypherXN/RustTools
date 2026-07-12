import { useEffect } from "react";
import { useWebSocket } from "../hooks/WebSocketProvider";
import { useAuth } from "../hooks/useAuth";
import { useActiveServer } from "../hooks/useActiveServer";
import { isDemoMode } from "../lib/demo";
import { assetUrl } from "../lib/asset-url";
import { playAlarmSound, prefetchCustomAlarmSound } from "../lib/alarm-sound";

export function AlarmNotifier() {
  const { user } = useAuth();
  const { epoch } = useActiveServer();

  useEffect(() => {
    if (!user || isDemoMode()) return;
    void prefetchCustomAlarmSound(epoch).catch(() => {
      /* optional — plays default siren if prefetch fails */
    });
  }, [user, epoch]);

  useWebSocket((event, payload) => {
    if (event !== "fcmAlarm" || isDemoMode()) return;

    const data = payload as {
      title?: string;
      message?: string;
      body?: Record<string, unknown>;
      browserSiren?: boolean;
      customAlarmSound?: boolean;
    };

    const entityName =
      (typeof data.body?.entityName === "string" && data.body.entityName) ||
      (typeof data.body?.name === "string" && data.body.name) ||
      null;
    const title = entityName ? `Raid Alert — ${entityName}` : data.title ?? "Raid Alert";
    const body = data.message?.trim() || "Smart alarm triggered";

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, tag: "rusttools-alarm" });
    }

    void playAlarmSound({
      browserSiren: data.browserSiren !== false,
      customAlarmSound: data.customAlarmSound === true,
      epoch,
    });
  });

  useEffect(() => {
    if (!user || isDemoMode()) return;
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register(assetUrl("sw.js")).catch(() => {
      /* optional */
    });
  }, [user]);

  return null;
}
