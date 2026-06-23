import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

interface HealthResponse {
  status: string;
  rustplus: { connected: boolean; activeServerId: string | null };
  fcm: { listening: boolean };
}

interface ServerInfoResponse {
  info: { name?: string; players?: number; queuedPlayers?: number; maxPlayers?: number };
  wipe: { label: string; secondsRemaining: number | null };
}

export function DashboardPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [server, setServer] = useState<ServerInfoResponse | null>(null);
  const [time, setTime] = useState<{ isDay?: boolean; time?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<HealthResponse>("/health")
      .then(setHealth)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    apiFetch<ServerInfoResponse>("/servers/active/info")
      .then(setServer)
      .catch(() => setServer(null));
    apiFetch<{ time: { isDay?: boolean; time?: string } }>("/servers/active/time")
      .then((d) => setTime(d.time))
      .catch(() => setTime(null));
  }, []);

  const info = server?.info;

  return (
    <div>
      <header className="page-header">
        <h1>Dashboard</h1>
        <p>Server status and quick overview.</p>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="grid">
        <section className="card">
          <h2>Connection</h2>
          <dl className="stat-list">
            <div>
              <dt>API</dt>
              <dd>{health?.status ?? "—"}</dd>
            </div>
            <div>
              <dt>Rust+</dt>
              <dd>{health?.rustplus.connected ? "Connected" : "Disconnected"}</dd>
            </div>
            <div>
              <dt>FCM Pairing</dt>
              <dd>{health?.fcm.listening ? "Listening" : "Not listening"}</dd>
            </div>
          </dl>
        </section>

        <section className="card">
          <h2>Server</h2>
          {info ? (
            <dl className="stat-list">
              <div>
                <dt>Name</dt>
                <dd>{info.name ?? "—"}</dd>
              </div>
              <div>
                <dt>Players</dt>
                <dd>
                  {info.players ?? 0}
                  {info.maxPlayers != null ? ` / ${info.maxPlayers}` : ""}
                </dd>
              </div>
              <div>
                <dt>Wipe in</dt>
                <dd>{server?.wipe.label ?? "—"}</dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>
                  {time?.time ?? "—"}
                  {time?.isDay != null ? (time.isDay ? " (day)" : " (night)") : ""}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="muted">No active Rust+ server. Pair a server in Settings.</p>
          )}
        </section>
      </div>
    </div>
  );
}
