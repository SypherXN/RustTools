import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

interface Server {
  id: string;
  name: string;
  ip: string;
  port: number;
  isActive: boolean;
}

export function ServerSwitcher() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(false);

  const load = () => {
    apiFetch<{ servers: Server[] }>("/servers")
      .then((d) => setServers(d.servers))
      .catch(() => setServers([]));
  };

  useEffect(() => {
    load();
  }, []);

  const activate = async (id: string) => {
    setLoading(true);
    try {
      await apiFetch(`/servers/${id}/activate`, { method: "POST" });
      load();
    } finally {
      setLoading(false);
    }
  };

  if (servers.length === 0) return null;

  return (
    <section className="card server-switcher">
      <h2>Servers</h2>
      <ul className="server-list">
        {servers.map((s) => (
          <li key={s.id} className={s.isActive ? "active" : ""}>
            <div>
              <strong>{s.name}</strong>
              <span className="muted">{s.ip}:{s.port}</span>
            </div>
            {!s.isActive && (
              <button type="button" disabled={loading} onClick={() => void activate(s.id)}>
                Activate
              </button>
            )}
            {s.isActive && <span className="badge badge-ok">Active</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
