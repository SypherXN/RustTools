import { useEffect } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import { useAuth } from "../hooks/useAuth";
import { isDemoMode } from "../lib/demo";
import { assetUrl } from "../lib/asset-url";

function playSiren(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    const sweep = setInterval(() => {
      osc.frequency.value = osc.frequency.value === 880 ? 440 : 880;
    }, 250);
    setTimeout(() => {
      clearInterval(sweep);
      osc.stop();
      void ctx.close();
    }, 4000);
  } catch {
    /* autoplay may be blocked until user gesture */
  }
}

export function AlarmNotifier() {
  const { user } = useAuth();

  useWebSocket((event, payload) => {
    if (event !== "fcmAlarm" || isDemoMode()) return;

    const data = payload as {
      title?: string;
      message?: string;
      body?: Record<string, unknown>;
      browserSiren?: boolean;
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

    if (data.browserSiren !== false) {
      playSiren();
    }
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
