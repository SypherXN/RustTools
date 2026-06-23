import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { useWebSocket } from "../hooks/useWebSocket";

interface TeamMember {
  name: string;
  steamId: string;
  isOnline: boolean;
  x?: number;
  y?: number;
}

export function TeamPage() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [time, setTime] = useState<{ isDay?: boolean; time?: string } | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [chatMessage, setChatMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    Promise.all([
      apiFetch<{ team: TeamMember[] }>("/servers/active/team"),
      apiFetch<{ time: { isDay?: boolean; time?: string } }>("/servers/active/time"),
    ])
      .then(([teamRes, timeRes]) => {
        setTeam(teamRes.team);
        setTime(timeRes.time);
      })
      .catch((err: Error) => setError(err.message));
  };

  useEffect(() => {
    load();
  }, []);

  useWebSocket((event, payload) => {
    if (event === "teamChat") {
      const p = payload as { message?: string };
      if (p.message) {
        setMessages((prev) => [...prev.slice(-49), p.message!]);
      }
    }
  });

  const sendChat = async () => {
    if (!chatMessage.trim()) return;
    try {
      await apiFetch("/servers/active/chat", {
        method: "POST",
        body: JSON.stringify({ message: chatMessage }),
      });
      setMessages((prev) => [...prev, `You: ${chatMessage}`]);
      setChatMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    }
  };

  return (
    <div>
      <header className="page-header">
        <h1>Team</h1>
        <p>Online roster, in-game time, and team chat.</p>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="grid">
        <section className="card">
          <h2>In-Game Time</h2>
          <p className="stat-big">
            {time?.time ?? "—"}
            {time?.isDay != null && (
              <span className="badge">{time.isDay ? "Day" : "Night"}</span>
            )}
          </p>
        </section>
        <section className="card">
          <h2>Roster ({team.filter((m) => m.isOnline).length} online)</h2>
          <ul className="team-list">
            {team.map((m) => (
              <li key={m.steamId}>
                <span className={m.isOnline ? "dot online" : "dot offline"} />
                <strong>{m.name}</strong>
                {m.x != null && m.y != null && (
                  <span className="muted"> @ {m.x}, {m.y}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Team Chat</h2>
        <div className="chat-feed">
          {messages.length === 0 && <p className="muted">No messages yet.</p>}
          {messages.map((msg, i) => (
            <p key={i} className="chat-line">
              {msg}
            </p>
          ))}
        </div>
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
      </section>
    </div>
  );
}
