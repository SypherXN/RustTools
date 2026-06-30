import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import type { AdminUserSummary, DiscordBlacklistEntry } from "@rusttools/shared";

export function AdminUsersPanel({ disabled }: { disabled: boolean }) {
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [blacklist, setBlacklist] = useState<DiscordBlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [blockDiscordId, setBlockDiscordId] = useState("");
  const [blockSteamId, setBlockSteamId] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [steamDraft, setSteamDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, blacklistRes] = await Promise.all([
        apiFetch<{ users: AdminUserSummary[] }>("/admin/users"),
        apiFetch<{ entries: DiscordBlacklistEntry[] }>("/admin/blacklist").catch(() => ({
          entries: [] as DiscordBlacklistEntry[],
        })),
      ]);
      setUsers(usersRes.users);
      setSteamDraft(Object.fromEntries(usersRes.users.map((user) => [user.id, user.steamId ?? ""])));
      setBlacklist(blacklistRes.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSteamId = async (user: AdminUserSummary, steamIdOverride?: string | null) => {
    const steamId =
      steamIdOverride !== undefined ? (steamIdOverride?.trim() ?? "") : (steamDraft[user.id]?.trim() ?? "");
    setBusy(`steam-${user.id}`);
    setMessage(null);
    setError(null);
    try {
      await apiFetch<{ ok: boolean; steamId: string | null }>(`/admin/users/${user.id}/steam-id`, {
        method: "PATCH",
        body: JSON.stringify({ steamId: steamId || null }),
      });
      setMessage(
        steamId
          ? `Steam ID saved for ${user.discordUsername}`
          : `Steam ID cleared for ${user.discordUsername}`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save Steam ID");
    } finally {
      setBusy(null);
    }
  };

  const removeUser = async (user: AdminUserSummary) => {
    if (
      !window.confirm(
        `Remove ${user.discordUsername}? This deletes their account, sessions, and push subscriptions.`,
      )
    ) {
      return;
    }

    setBusy(user.id);
    setMessage(null);
    setError(null);
    try {
      await apiFetch(`/admin/users/${user.id}`, { method: "DELETE" });
      setMessage(`Removed ${user.discordUsername}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove user");
    } finally {
      setBusy(null);
    }
  };

  const blockUser = async (user: AdminUserSummary) => {
    const reason = window.prompt(`Block reason for ${user.discordUsername}?`, "") ?? "";
    setBusy(`block-${user.id}`);
    setMessage(null);
    setError(null);
    try {
      await apiFetch("/admin/blacklist", {
        method: "POST",
        body: JSON.stringify({
          discordId: user.discordId,
          steamId: user.steamId ?? undefined,
          reason,
        }),
      });
      setMessage(`Blocked ${user.discordUsername}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to block user");
    } finally {
      setBusy(null);
    }
  };

  const unblockEntry = async (entry: DiscordBlacklistEntry) => {
    if (!window.confirm("Remove this block?")) return;

    setBusy(entry.id);
    setMessage(null);
    setError(null);
    try {
      await apiFetch(`/admin/blacklist/${entry.id}`, { method: "DELETE" });
      setMessage("Block removed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove block");
    } finally {
      setBusy(null);
    }
  };

  const addBlock = async () => {
    const discordId = blockDiscordId.trim();
    const steamId = blockSteamId.trim();
    if (!discordId && !steamId) {
      setError("Provide a Discord user ID or Steam ID");
      return;
    }

    setBusy("add-block");
    setMessage(null);
    setError(null);
    try {
      await apiFetch("/admin/blacklist", {
        method: "POST",
        body: JSON.stringify({
          discordId: discordId || undefined,
          steamId: steamId || undefined,
          reason: blockReason.trim(),
        }),
      });
      setBlockDiscordId("");
      setBlockSteamId("");
      setBlockReason("");
      setMessage("Block added");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add block");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {loading && <p className="muted">Loading users…</p>}
      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-ok">{message}</div>}

      {!loading && (
        <>
          <p className="muted">
            Remove accounts, assign Steam IDs for teammates, or block Discord/Steam IDs from the web app and bot
            commands.
          </p>
          <ul className="server-list admin-users-list">
            {users.map((user) => (
              <li key={user.id}>
                <div className="admin-user-main">
                  <div>
                    <strong>{user.discordUsername}</strong>
                    <span className="muted">Discord {user.discordId}</span>
                    {user.blocked && <span className="badge">Blocked</span>}
                  </div>
                  <div className="admin-user-steam">
                    <label className="admin-user-steam-label">
                      Steam ID
                      <input
                        value={steamDraft[user.id] ?? ""}
                        onChange={(e) =>
                          setSteamDraft((prev) => ({ ...prev, [user.id]: e.target.value }))
                        }
                        disabled={disabled || busy !== null}
                        placeholder="7656119… (F1 → player.id)"
                        inputMode="numeric"
                        pattern="\d{17}"
                      />
                    </label>
                    <div className="inline-actions">
                      <button
                        type="button"
                        disabled={disabled || busy !== null}
                        onClick={() => void saveSteamId(user)}
                      >
                        {busy === `steam-${user.id}` ? "Saving…" : "Save Steam ID"}
                      </button>
                      {user.steamId && (
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={disabled || busy !== null}
                          onClick={() => {
                            setSteamDraft((prev) => ({ ...prev, [user.id]: "" }));
                            void saveSteamId(user, null);
                          }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="inline-actions">
                  {!user.blocked && (
                    <button
                      type="button"
                      disabled={disabled || busy !== null}
                      onClick={() => void blockUser(user)}
                    >
                      {busy === `block-${user.id}` ? "Blocking…" : "Block"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="danger"
                    disabled={disabled || busy !== null}
                    onClick={() => void removeUser(user)}
                  >
                    {busy === user.id ? "Removing…" : "Remove"}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <h3>Block by ID</h3>
          <div className="form-row">
            <label>
              Discord user ID
              <input
                value={blockDiscordId}
                onChange={(e) => setBlockDiscordId(e.target.value)}
                disabled={disabled || busy !== null}
                placeholder="123456789012345678"
              />
            </label>
            <label>
              Steam ID
              <input
                value={blockSteamId}
                onChange={(e) => setBlockSteamId(e.target.value)}
                disabled={disabled || busy !== null}
                placeholder="7656119…"
              />
            </label>
            <label>
              Reason
              <input
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                disabled={disabled || busy !== null}
              />
            </label>
            <button type="button" disabled={disabled || busy !== null} onClick={() => void addBlock()}>
              {busy === "add-block" ? "Adding…" : "Add block"}
            </button>
          </div>

          {blacklist.length > 0 && (
            <>
              <h3>Blocked entries</h3>
              <ul className="server-list">
                {blacklist.map((entry) => (
                  <li key={entry.id}>
                    <div>
                      <strong>
                        {entry.discordId ? `Discord ${entry.discordId}` : ""}
                        {entry.discordId && entry.steamId ? " · " : ""}
                        {entry.steamId ? `Steam ${entry.steamId}` : ""}
                      </strong>
                      {entry.reason && <span className="muted">{entry.reason}</span>}
                    </div>
                    <button
                      type="button"
                      disabled={disabled || busy !== null}
                      onClick={() => void unblockEntry(entry)}
                    >
                      {busy === entry.id ? "Removing…" : "Unblock"}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
