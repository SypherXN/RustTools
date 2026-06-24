import { useEffect, useState } from "react";
import type { DeepSeaStatus, TeamApiResponse } from "@rusttools/shared";
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
  const [teamCounts, setTeamCounts] = useState<{ online: number; total: number } | null>(null);
  const [deepSea, setDeepSea] = useState<DeepSeaStatus | null>(null);
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
    apiFetch<TeamApiResponse>("/servers/active/team")
      .then((data) => {
        const members = data.team.members;
        setTeamCounts({
          online: members.filter((m) => m.isOnline).length,
          total: members.length,
        });
      })
      .catch(() => setTeamCounts(null));
    apiFetch<{ status: DeepSeaStatus }>("/servers/active/deepsea")
      .then((d) => setDeepSea(d.status))
      .catch(() => setDeepSea(null));
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
                <dt>Team</dt>
                <dd>
                  {teamCounts != null
                    ? `${teamCounts.online} / ${teamCounts.total} online`
                    : "—"}
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

        <section className="card">
          <h2>Deep Sea</h2>
          {deepSea ? (
            <dl className="stat-list">
              <div>
                <dt>Status</dt>
                <dd>{deepSea.isOpen ? "Open" : deepSea.phase === "closed" ? "Closed" : "Unknown"}</dd>
              </div>
              <div>
                <dt>Timer</dt>
                <dd>{deepSea.label}</dd>
              </div>
              {deepSea.offshoreVendingCount > 0 && (
                <div>
                  <dt>Offshore shops</dt>
                  <dd>{deepSea.offshoreVendingCount}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="muted">Deep Sea status unavailable — connect Rust+ to track open/close timers.</p>
          )}
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            In-game: <code>!deepsea</code> or <code>!ds</code> · Discord: <code>/deepsea</code>
          </p>
        </section>
      </div>
    </div>
  );
}
