import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listStaticCctvCodes } from "@rusttools/shared";
import { apiFetch } from "../lib/api";
import { useWebSocket } from "../hooks/WebSocketProvider";
import { useCan } from "../hooks/usePermissions";
import { CameraFeedPlaceholder } from "../components/CameraFeedPlaceholder";

interface SavedCamera {
  id: string;
  cameraId: string;
  label: string;
}

export function CameraPage() {
  const canSwitch = useCan("switch");
  const [cameras, setCameras] = useState<SavedCamera[]>([]);
  const [activeCameraId, setActiveCameraId] = useState<string | null>(null);
  const [manualId, setManualId] = useState("");
  const [isAutoTurret, setIsAutoTurret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const lastInputAt = useRef(0);

  const cctvCodes = useMemo(() => listStaticCctvCodes(), []);

  const load = async () => {
    try {
      const data = await apiFetch<{ groups: unknown[]; cameras: SavedCamera[] }>("/device-library");
      setCameras(data.cameras);
    } catch {
      // optional
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useWebSocket((event, payload) => {
    if (event === "cameraFrame" && imgRef.current) {
      const p = payload as { frame?: string; cameraId?: string };
      if (p.frame) {
        imgRef.current.src = `data:image/png;base64,${p.frame}`;
        setHasFrame(true);
        setConnecting(false);
      }
    }
  });

  const subscribe = useCallback(async (cameraId: string) => {
    setError(null);
    setConnecting(true);
    setHasFrame(false);
    if (imgRef.current) {
      imgRef.current.removeAttribute("src");
    }
    try {
      await apiFetch(`/cameras/unsubscribe`, { method: "POST", body: "{}" });
      const result = await apiFetch<{ ok: boolean; info?: { controlFlags?: number } }>(
        `/cameras/${encodeURIComponent(cameraId)}/subscribe`,
        { method: "POST", body: "{}" },
      );
      setActiveCameraId(cameraId);
      setIsAutoTurret((result.info?.controlFlags ?? 0) > 0);
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Subscribe failed");
      setConnected(false);
      setConnecting(false);
    }
  }, []);

  const unsubscribe = async () => {
    await apiFetch("/cameras/unsubscribe", { method: "POST", body: "{}" });
    setActiveCameraId(null);
    setConnected(false);
    setConnecting(false);
    setHasFrame(false);
    if (imgRef.current) {
      imgRef.current.removeAttribute("src");
    }
  };

  const sendInput = async (dx: number, dy: number, buttons = 0) => {
    if (!canSwitch || !connected) return;
    const now = Date.now();
    if (now - lastInputAt.current < 150) return;
    lastInputAt.current = now;
    await apiFetch("/cameras/input", {
      method: "POST",
      body: JSON.stringify({ buttons, mouseDeltaX: dx, mouseDeltaY: dy }),
    });
  };

  const shoot = async () => {
    if (!canSwitch || !connected) return;
    await apiFetch("/cameras/shoot", { method: "POST", body: "{}" });
  };

  return (
    <div>
      <header className="page-header">
        <h1>Live cameras</h1>
        <p>
          Subscribe to Rust+ CCTV or auto turret feeds. Only one viewer controls a camera at a time in-game. Most
          servers require the owner to run <code>cctvrender.enabled true</code> in the server console before external
          camera feeds work.
        </p>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="card" style={{ marginBottom: "1rem" }}>
        <div className="search-row">
          <input
            list="cctv-codes"
            placeholder="Camera ID (e.g. DOME1, OILRIG1L1, or your PTZ name)"
            value={manualId}
            onChange={(e) => setManualId(e.target.value.toUpperCase())}
          />
          <datalist id="cctv-codes">
            {cctvCodes.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
          {canSwitch && (
            <button type="button" onClick={() => void subscribe(manualId)}>
              Connect
            </button>
          )}
          {connected && (
            <button type="button" className="btn-secondary" onClick={() => void unsubscribe()}>
              Disconnect
            </button>
          )}
        </div>
        <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>
          Dome monument uses <code>DOME1</code> or <code>DOMETOP</code>, not DOMELAND. Player-placed PTZ/turret
          cameras use the name you set on the Computer Station in-game.
        </p>
        {cameras.length > 0 && (
          <div className="btn-row" style={{ marginTop: "0.75rem" }}>
            {cameras.map((cam) => (
              <button key={cam.id} type="button" onClick={() => void subscribe(cam.cameraId)}>
                {cam.label}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card camera-viewer-wrap">
        <div className="camera-viewer-stage">
          <img
            ref={imgRef}
            className={`camera-viewer${hasFrame ? " camera-viewer--live" : ""}`}
            alt={activeCameraId ? `Camera ${activeCameraId}` : "Camera feed"}
          />
          {!hasFrame && (
            <CameraFeedPlaceholder
              mode={connecting || connected ? "connecting" : "idle"}
              cameraId={activeCameraId}
            />
          )}
        </div>
        {connected && hasFrame && activeCameraId && (
          <div className="camera-viewer-label">
            <span className="camera-viewer-label__rec">
              <span className="camera-viewer-label__rec-dot" />
              LIVE
            </span>
            <code>{activeCameraId}</code>
          </div>
        )}
      </section>

      {connected && canSwitch && (
        <section className="card camera-controls">
          <h2>Controls</h2>
          <div className="camera-pad">
            <button type="button" aria-label="Up" onClick={() => void sendInput(0, 5)}>
              ↑
            </button>
            <div className="camera-pad-row">
              <button type="button" aria-label="Left" onClick={() => void sendInput(-5, 0)}>
                ←
              </button>
              <button type="button" aria-label="Right" onClick={() => void sendInput(5, 0)}>
                →
              </button>
            </div>
            <button type="button" aria-label="Down" onClick={() => void sendInput(0, -5)}>
              ↓
            </button>
          </div>
          {isAutoTurret && (
            <button type="button" className="camera-shoot-btn" onClick={() => void shoot()}>
              Fire
            </button>
          )}
        </section>
      )}
    </div>
  );
}
