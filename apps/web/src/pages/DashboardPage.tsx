import { useEffect, useState } from "react";
import type { DeepSeaStatus, TeamApiResponse, WorldEventsStatus } from "@rusttools/shared";
import { formatDurationSince, formatDiscordHelpSections, formatWebHelpCategories } from "@rusttools/shared";
import { apiFetch } from "../lib/api";
import { useWebSocket } from "../hooks/useWebSocket";
import { useActiveServer } from "../hooks/useActiveServer";
import { useRustPlusStatus } from "../hooks/useRustPlusStatus";

interface ServerInfoResponse {
  info: { name?: string; players?: number; queuedPlayers?: number; maxPlayers?: number };
  wipe: { label: string; secondsRemaining: number | null };
  mapMeta?: {
    seed: number | null;
    salt: number | null;
    mapName: string | null;
    mapSize: number | null;
  };
  connectString?: string | null;
}

export function DashboardPage() {
  const { health } = useRustPlusStatus();
  const { epoch } = useActiveServer();
  const [server, setServer] = useState<ServerInfoResponse | null>(null);
  const [time, setTime] = useState<{ isDay?: boolean; time?: string } | null>(null);
  const [teamCounts, setTeamCounts] = useState<{ online: number; total: number } | null>(null);
  const [deepSea, setDeepSea] = useState<DeepSeaStatus | null>(null);
  const [worldEvents, setWorldEvents] = useState<WorldEventsStatus | null>(null);

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
    apiFetch<{ status: WorldEventsStatus }>("/servers/active/world-events")
      .then((d) => setWorldEvents(d.status))
      .catch(() => setWorldEvents(null));
  }, [epoch]);

  useWebSocket((event, payload) => {
    if (event === "deepSeaChanged") setDeepSea(payload as DeepSeaStatus);
    if (event === "worldEventsChanged") setWorldEvents(payload as WorldEventsStatus);
    if (event === "teamChanged") {
      const p = payload as TeamApiResponse | null;
      if (p?.team?.members) {
        setTeamCounts({
          online: p.team.members.filter((m) => m.isOnline).length,
          total: p.team.members.length,
        });
      }
    }
  });

  const nowSec = Math.floor(Date.now() / 1000);

  const info = server?.info;

  return (
    <div>
      <header className="page-header">
        <h1>Dashboard</h1>
        <p>Server status and quick overview.</p>
      </header>

      <div className="grid">
        <section className="card">
          <h2>Connection</h2>
          <dl className="stat-list">
            <div>
              <dt>API</dt>
              <dd className={health?.status === "ok" ? "status-ok" : undefined}>
                {health?.status ?? "—"}
              </dd>
            </div>
            <div>
              <dt>Rust+</dt>
              <dd className={health?.rustplus.connected ? "status-ok" : "status-warn"}>
                {health?.rustplus.connected ? "Connected" : "Disconnected"}
              </dd>
            </div>
            <div>
              <dt>FCM Pairing</dt>
              <dd className={health?.fcm.listening ? "status-ok" : "status-warn"}>
                {health?.fcm.listening ? "Listening" : "Not listening"}
              </dd>
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
              {server?.mapMeta && (
                <>
                  <div>
                    <dt>Map</dt>
                    <dd>{server.mapMeta.mapName ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Seed / Salt</dt>
                    <dd>
                      {server.mapMeta.seed ?? "—"} / {server.mapMeta.salt ?? "—"}
                    </dd>
                  </div>
                  {server.mapMeta.mapSize != null && (
                    <div>
                      <dt>World size</dt>
                      <dd>{server.mapMeta.mapSize}m</dd>
                    </div>
                  )}
                </>
              )}
              {server?.connectString && (
                <div>
                  <dt>F1 connect</dt>
                  <dd>
                    <code className="connect-string">{server.connectString}</code>{" "}
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void navigator.clipboard.writeText(server.connectString!)}
                    >
                      Copy
                    </button>
                  </dd>
                </div>
              )}
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
        </section>

        <section className="card">
          <h2>World Events</h2>
          {worldEvents ? (
            <dl className="stat-list">
              <div>
                <dt>Cargo</dt>
                <dd>
                  {worldEvents.cargo.active
                    ? `Active @ ${worldEvents.cargo.grid ?? "?"}`
                    : `Off map (last ${formatDurationSince(worldEvents.cargo.sinceSec, nowSec)})`}
                </dd>
              </div>
              <div>
                <dt>Patrol Heli</dt>
                <dd>
                  {worldEvents.heli.active
                    ? `Active @ ${worldEvents.heli.grid ?? "?"}`
                    : worldEvents.stats.heliLastDownAt
                      ? `Down ${formatDurationSince(worldEvents.stats.heliLastDownAt, nowSec)}`
                      : `Off map (last ${formatDurationSince(worldEvents.heli.sinceSec, nowSec)})`}
                </dd>
              </div>
              <div>
                <dt>Chinook</dt>
                <dd>
                  {worldEvents.chinook.active
                    ? `Active @ ${worldEvents.chinook.grid ?? "?"}`
                    : `Off map (last ${formatDurationSince(worldEvents.chinook.sinceSec, nowSec)})`}
                </dd>
              </div>
              <div>
                <dt>Traveling Vendor</dt>
                <dd>
                  {worldEvents.vendor.active
                    ? `Active @ ${worldEvents.vendor.grid ?? "?"}`
                    : `Off map (last ${formatDurationSince(worldEvents.vendor.sinceSec, nowSec)})`}
                </dd>
              </div>
              <div>
                <dt>Small Oil Rig</dt>
                <dd>
                  {worldEvents.oilRigs.small.triggered
                    ? `Crate unlocks in ${worldEvents.oilRigs.small.crateUnlockLabel ?? "?"}`
                    : worldEvents.oilRigs.small.lastTriggeredAt
                      ? `Idle (last ${formatDurationSince(worldEvents.oilRigs.small.lastTriggeredAt, nowSec)})`
                      : "Idle"}
                </dd>
              </div>
              <div>
                <dt>Large Oil Rig</dt>
                <dd>
                  {worldEvents.oilRigs.large.triggered
                    ? `Crate unlocks in ${worldEvents.oilRigs.large.crateUnlockLabel ?? "?"}`
                    : worldEvents.oilRigs.large.lastTriggeredAt
                      ? `Idle (last ${formatDurationSince(worldEvents.oilRigs.large.lastTriggeredAt, nowSec)})`
                      : "Idle"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="muted">World event stats unavailable — connect Rust+ and enable map polling.</p>
          )}
        </section>
      </div>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Commands</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          In-game team chat and Discord command reference. Type <code>!help</code> in team chat for a
          condensed list.
        </p>
        <h3 style={{ marginTop: "1.25rem", marginBottom: "0.75rem" }}>In-game team chat</h3>
        <div className="help-section-grid">
          {formatWebHelpCategories().map((category) => (
            <div key={category.name} className="help-category">
              <h3>{category.name}</h3>
              <ul>
                {category.commands.map((cmd) => (
                  <li key={cmd}>
                    <code>{cmd}</code>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <h3 style={{ marginTop: "1.5rem", marginBottom: "0.75rem" }}>Discord</h3>
        <div className="help-section-grid">
          {formatDiscordHelpSections().map((section) => (
            <div key={section.name} className="help-category">
              <h3>{section.name}</h3>
              <div
                className="muted"
                style={{ fontSize: "0.88rem", lineHeight: 1.5, whiteSpace: "pre-line" }}
              >
                {section.value}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
