import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ParsedTeamInfo, TeamApiResponse, TeamChatMessage, TeamConnectionEvent, TeamDeathEvent, TeamRosterMember } from "@rusttools/shared";
import {
  appendTeamChatMessage,
  formatTeamAfkDuration,
  formatTeamConnectionAgo,
  formatTeamConnectionLabel,
  formatTeamDeathAgo,
  formatTeamSession,
  sortTeamRoster,
  teamMemberStatus,
} from "@rusttools/shared";
import { apiFetch } from "../lib/api";
import { formatTeamGridLocation } from "../lib/team-location";
import { useWebSocket } from "../hooks/useWebSocket";
import { useCan } from "../hooks/usePermissions";

export function TeamPage() {
  const [teamInfo, setTeamInfo] = useState<ParsedTeamInfo | null>(null);
  const [deaths, setDeaths] = useState<TeamDeathEvent[]>([]);
  const [deathHistory, setDeathHistory] = useState<TeamDeathEvent[]>([]);
  const [connections, setConnections] = useState<TeamConnectionEvent[]>([]);
  const [canPromote, setCanPromote] = useState(false);
  const [pairedPlayerId, setPairedPlayerId] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [worldSize, setWorldSize] = useState<number | null>(null);
  const [messages, setMessages] = useState<TeamChatMessage[]>([]);
  const [chatMessage, setChatMessage] = useState("");
  const chatFeedRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const canSwitch = useCan("switch");
  const canAdmin = useCan("admin");

  const applyTeamPayload = useCallback((data: TeamApiResponse) => {
    setTeamInfo(data.team);
    setDeaths(data.deaths);
    setCanPromote(data.canPromote);
    setPairedPlayerId(data.pairedPlayerId);
    setError(null);
  }, []);

  const loadDeathHistory = useCallback(() => {
    void apiFetch<{ deaths: TeamDeathEvent[] }>("/servers/active/team/deaths")
      .then((data) => setDeathHistory(data.deaths))
      .catch(() => {
        /* history optional when DB is empty or API unavailable */
      });
  }, []);

  const loadConnections = useCallback(() => {
    void apiFetch<{ connections: TeamConnectionEvent[] }>("/servers/active/team/connections")
      .then((data) => setConnections(data.connections))
      .catch(() => {
        /* connection log optional */
      });
  }, []);

  const loadChat = useCallback(() => {
    void apiFetch<{ messages: TeamChatMessage[] }>("/servers/active/team/chat")
      .then((data) => setMessages(data.messages))
      .catch(() => {
        /* chat history optional when Rust+ is disconnected */
      });
  }, []);

  const loadTeam = useCallback(() => {
    void apiFetch<TeamApiResponse>("/servers/active/team")
      .then(applyTeamPayload)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
    loadChat();
    loadDeathHistory();
    loadConnections();
  }, [applyTeamPayload, loadChat, loadDeathHistory, loadConnections]);

  useEffect(() => {
    setLoading(true);
    loadTeam();
    void apiFetch<{ info: { mapSize?: number } }>("/servers/active/info")
      .then((res) => {
        if (res.info.mapSize && res.info.mapSize > 0) {
          setWorldSize(res.info.mapSize);
        }
      })
      .catch(() => {
        /* map size optional for grid labels */
      });
    const interval = setInterval(loadTeam, 30_000);
    return () => clearInterval(interval);
  }, [loadTeam]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    chatFeedRef.current?.scrollTo({ top: chatFeedRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useWebSocket((event, payload) => {
    if (event === "teamChat") {
      const p = payload as Partial<TeamChatMessage>;
      const text = p.message?.trim();
      if (!text) return;
      setMessages((prev) =>
        appendTeamChatMessage(prev, {
          steamId: p.steamId ?? "",
          name: p.name?.trim() || "Unknown",
          message: text,
          sentAt: p.sentAt ?? Math.floor(Date.now() / 1000),
        }),
      );
      return;
    }
    if (event === "teamConnection") {
      const entry = payload as TeamConnectionEvent;
      if (!entry?.steamId || !entry.occurredAt) return;
      setConnections((prev) => {
        const key = `${entry.steamId}-${entry.occurredAt}-${entry.event}`;
        if (prev.some((c) => `${c.steamId}-${c.occurredAt}-${c.event}` === key)) {
          return prev;
        }
        return [entry, ...prev].slice(0, 50);
      });
      return;
    }
    if (event === "teamChanged") {
      const p = payload as TeamApiResponse | null;
      if (p?.team?.members) {
        applyTeamPayload(p);
        setLoading(false);
        loadDeathHistory();
      } else {
        loadTeam();
      }
    }
  });

  const promoteLeader = async (member: TeamRosterMember) => {
    if (
      !window.confirm(
        `Make ${member.name} team leader? You will lose leader privileges on the paired Rust+ account.`,
      )
    ) {
      return;
    }
    setPromotingId(member.steamId);
    setError(null);
    try {
      const data = await apiFetch<TeamApiResponse>("/servers/active/team/promote", {
        method: "POST",
        body: JSON.stringify({ steamId: member.steamId }),
      });
      applyTeamPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to promote team leader");
    } finally {
      setPromotingId(null);
    }
  };

  const sendChat = async () => {
    if (!chatMessage.trim()) return;
    try {
      await apiFetch("/servers/active/chat", {
        method: "POST",
        body: JSON.stringify({ message: chatMessage }),
      });
      setChatMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    }
  };

  const members = teamInfo ? sortTeamRoster(teamInfo.members) : [];
  const onlineCount = members.filter((m) => m.isOnline).length;

  return (
    <div>
      <header className="page-header">
        <h1>Team</h1>
        <p>Live roster and team chat.</p>
        {pairedPlayerId && (
          <p className="muted team-paired-hint">
            Rust+ paired as <code>{pairedPlayerId}</code>.
            {canPromote
              ? " You can promote teammates because this account is team leader."
              : " Promote is only available when the paired account is team leader."}
          </p>
        )}
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="team-main-layout">
        <section className="card team-roster-panel">
          <h2>Roster ({onlineCount} online)</h2>
          {loading && members.length === 0 ? (
            <p className="muted">Loading team...</p>
          ) : members.length === 0 ? (
            <p className="muted">No team members returned. Make sure you are on a team in-game.</p>
          ) : (
            <ul className="team-roster">
              {members.map((m) => (
                <TeamRosterRow
                  key={m.steamId}
                  member={m}
                  worldSize={worldSize}
                  now={now}
                  canPromote={canPromote && canAdmin}
                  promoting={promotingId === m.steamId}
                  onPromote={() => void promoteLeader(m)}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="card team-chat-panel">
          <h2>Team Chat</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Type <code>!deepsea</code> or <code>!ds</code> for Deep Sea timer status. Roster commands:{" "}
            <code>!online</code>, <code>!offline</code>, <code>!afk</code>, <code>!alive</code>. Team members can
            type <code>!leader</code> when RustTools is paired with the current leader. TC upkeep report:{" "}
            <code>!upkeepdetail</code>. Admins:{" "}
            <code>!mute</code> / <code>!unmute</code>. Send a Discord DM with{" "}
            <code>!send username message</code>.
          </p>
          <div className="chat-feed team-chat-feed" ref={chatFeedRef}>
            {messages.length === 0 && <p className="muted">No messages yet.</p>}
            {messages.map((msg) => (
              <p key={`${msg.steamId}-${msg.sentAt}-${msg.message}`} className="chat-line">
                <strong>{msg.name}</strong>: {msg.message}
              </p>
            ))}
          </div>
          {canSwitch ? (
            <div className="chat-row">
              <input
                type="text"
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                placeholder="Message to team..."
                onKeyDown={(e) => e.key === "Enter" && void sendChat()}
              />
              <button type="button" onClick={() => void sendChat()}>
                Send
              </button>
            </div>
          ) : (
            <p className="muted">You need Switch permission to send team chat messages.</p>
          )}
        </section>
      </div>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Connection log</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Join and disconnect events are logged to Discord and this page (no in-game reply).
        </p>
        {connections.length === 0 ? (
          <p className="muted">No connection events recorded yet.</p>
        ) : (
          <ul className="team-death-list">
            {connections.map((entry) => (
              <TeamConnectionRow key={`${entry.steamId}-${entry.occurredAt}-${entry.event}`} entry={entry} now={now} />
            ))}
          </ul>
        )}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Death history</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Persisted across sessions. Session tracker also shows {deaths.length} recent death
          {deaths.length === 1 ? "" : "s"} this run.
        </p>
        {deathHistory.length === 0 ? (
          <p className="muted">No deaths recorded yet.</p>
        ) : (
          <ul className="team-death-list">
            {deathHistory.map((death) => (
              <TeamDeathRow key={`${death.steamId}-${death.deathTime}`} death={death} now={now} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TeamDeathRow({ death, now }: { death: TeamDeathEvent; now: number }) {
  const ago = formatTeamDeathAgo(death.deathTime, now);
  const location =
    death.grid ??
    (death.x != null && death.y != null ? `${Math.round(death.x)}, ${Math.round(death.y)}` : null);

  return (
    <li className="team-death-row">
      <div className="team-death-main">
        <strong>{death.name}</strong>
        {ago && <span className="muted">{ago}</span>}
      </div>
      {location && <span className="team-death-location muted">{location}</span>}
    </li>
  );
}

function TeamConnectionRow({ entry, now }: { entry: TeamConnectionEvent; now: number }) {
  const ago = formatTeamConnectionAgo(entry.occurredAt, now);
  const verb = entry.event === "connected" ? "Connected" : "Disconnected";

  return (
    <li className="team-death-row">
      <div className="team-death-main">
        <strong>{formatTeamConnectionLabel(entry)}</strong>
        {ago && <span className="muted">{ago}</span>}
      </div>
      <span className="team-death-location muted">{verb}</span>
    </li>
  );
}

function TeamRosterRow({
  member,
  worldSize,
  now,
  canPromote,
  promoting,
  onPromote,
}: {
  member: TeamRosterMember;
  worldSize: number | null;
  now: number;
  canPromote: boolean;
  promoting: boolean;
  onPromote: () => void;
}) {
  const status = teamMemberStatus(member);
  const location =
    worldSize != null ? formatTeamGridLocation(member, worldSize) : null;
  const session = formatTeamSession(member.spawnTime, member.isOnline, now);
  const deathAgo = status === "dead" ? formatTeamDeathAgo(member.deathTime, now) : null;
  const afkDuration = status === "afk" ? formatTeamAfkDuration(member.afkSince, now) : null;
  const canMap = member.locationKnown !== false && member.x != null && member.y != null;

  const statusParts: string[] = [];
  if (status === "offline") {
    statusParts.push("Offline");
  } else if (status === "dead") {
    statusParts.push("Dead");
    if (deathAgo) statusParts.push(deathAgo);
  } else if (status === "afk") {
    statusParts.push("AFK");
    if (afkDuration) statusParts.push(afkDuration);
  } else {
    statusParts.push("Active");
    if (session) statusParts.push(`online ${session}`);
  }

  const dotClass =
    status === "offline" ? "offline" : status === "dead" ? "dead" : status === "afk" ? "afk" : "online";

  return (
    <li className={`team-roster-row${status === "offline" ? " offline" : ""}`}>
      <div className="team-roster-main">
        <span className={`dot ${dotClass}`} />
        <div className="team-roster-ident">
          <div className="team-roster-name">
            <strong>{member.name}</strong>
            {member.isLeader && <span className="badge team-leader-badge">Leader</span>}
            {status === "dead" && <span className="badge team-dead-badge">Dead</span>}
            {status === "afk" && <span className="badge team-afk-badge">AFK</span>}
          </div>
          <div className="team-roster-meta muted">
            {statusParts.join(" · ")}
            {location ? ` · ${location}` : status !== "offline" ? " · Location unknown" : ""}
          </div>
        </div>
      </div>
      <div className="team-roster-actions">
        {canPromote && !member.isLeader && (
          <button
            type="button"
            className="btn-secondary team-promote-btn"
            disabled={promoting}
            onClick={onPromote}
          >
            {promoting ? "Promoting…" : "Make leader"}
          </button>
        )}
        {canMap && (
          <Link className="btn-secondary team-map-link" to={`/map?member=${member.steamId}`}>
            View on map
          </Link>
        )}
      </div>
    </li>
  );
}
