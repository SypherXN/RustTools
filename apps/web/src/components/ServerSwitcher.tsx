import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { useCan } from "../hooks/usePermissions";
import { useActiveServer } from "../hooks/useActiveServer";

interface Server {
  id: string;
  name: string;
  ip: string;
  port: number;
  isActive: boolean;
  companionServerId?: string | null;
}

/**
 * UUID-paired relay rows carry no legacy ip/port (`""`/`0`). Rendering them as
 * "Rust+ relay · <uuid>" avoids a fake client.connect address.
 */
function serverAddressLabel(server: Server): string {
  if (server.companionServerId) return `Rust+ relay · ${server.companionServerId}`;
  if (!server.ip && server.port === 0) return "Rust+ relay (no direct address)";
  return `${server.ip}:${server.port}`;
}

export function ServerSwitcher() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAdmin = useCan("admin");
  const { notifyActivated } = useActiveServer();

  const load = () => {
    apiFetch<{ servers: Server[] }>("/servers")
      .then((d) => {
        setServers(d.servers);
        setError(null);
      })
      .catch(() => setServers([]));
  };

  useEffect(() => {
    load();
  }, []);

  const activate = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/servers/${id}/activate`, { method: "POST" });
      load();
      notifyActivated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate server");
    } finally {
      setLoading(false);
    }
  };

  const removeServer = async (server: Server) => {
    if (
      !window.confirm(
        `Delete "${server.name}"? This removes all devices, automations, map data, and procgen files for that server.`,
      )
    ) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/servers/${server.id}`, { method: "DELETE" });
      load();
      notifyActivated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete server");
    } finally {
      setLoading(false);
    }
  };

  if (servers.length === 0) return null;

  return (
    <section className="card server-switcher">
      <h2>Servers</h2>
      {error && <div className="alert alert-error">{error}</div>}
      <ul className="server-list">
        {servers.map((s) => (
          <li key={s.id} className={s.isActive ? "active" : ""}>
            <div>
              <strong>{s.name}</strong>
              <span className="muted">{serverAddressLabel(s)}</span>
            </div>
            {!s.isActive && canAdmin && (
              <button type="button" disabled={loading} onClick={() => void activate(s.id)}>
                Activate
              </button>
            )}
            {canAdmin && (
              <button
                type="button"
                className="danger"
                disabled={loading}
                onClick={() => void removeServer(s)}
              >
                Delete
              </button>
            )}
            {!s.isActive && !canAdmin && <span className="muted">Inactive</span>}
            {s.isActive && <span className="badge badge-ok">Active</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
