import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

interface AuditEvent {
  id: string;
  userId: string | null;
  discordId: string | null;
  discordUsername: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: string | null;
  createdAt: string;
}

export function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ events: AuditEvent[] }>("/audit")
      .then((data) => setEvents(data.events))
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div>
      <header className="page-header">
        <h1>Audit Log</h1>
        <p>Recent device toggles, renames, and automations.</p>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="card">
        {events.length === 0 ? (
          <p className="muted">No audit events yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Target</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{new Date(event.createdAt).toLocaleString()}</td>
                  <td>
                    {event.discordUsername ? (
                      <>
                        <strong>{event.discordUsername}</strong>
                        {event.discordId && (
                          <div className="muted" style={{ fontSize: "0.82rem" }}>
                            <code>{event.discordId}</code>
                          </div>
                        )}
                      </>
                    ) : event.userId ? (
                      <code>{event.userId}</code>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{event.action}</td>
                  <td>
                    {event.targetType ?? "—"}
                    {event.targetId ? ` #${event.targetId}` : ""}
                  </td>
                  <td>
                    <code className="audit-meta">
                      {event.metadata ?? "—"}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
