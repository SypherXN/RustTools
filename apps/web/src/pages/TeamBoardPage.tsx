import { useCallback, useEffect, useMemo, useState } from "react";
import type { TeamBoardEntry, TeamBoardEntryKind } from "@rusttools/shared";
import {
  collectTeamBoardCategories,
  groupTeamBoardEntries,
  normalizeTeamBoardCategory,
  teamBoardCategoryLabel,
} from "@rusttools/shared";
import { apiFetch } from "../lib/api";
import { useCan } from "../hooks/usePermissions";
import { useActiveServer } from "../hooks/useActiveServer";

type BoardFilter = "all" | TeamBoardEntryKind;
type BoardScope = "global" | "server";

const EMPTY_FORM = {
  kind: "note" as TeamBoardEntryKind,
  title: "",
  content: "",
  category: "",
  pinned: false,
};

function filterEntries(
  entries: TeamBoardEntry[],
  kindFilter: BoardFilter,
  categoryFilter: string,
): TeamBoardEntry[] {
  return entries.filter((entry) => {
    if (kindFilter !== "all" && entry.kind !== kindFilter) return false;
    if (categoryFilter && normalizeTeamBoardCategory(entry.category) !== categoryFilter) return false;
    return true;
  });
}

function boardApiPath(scope: BoardScope, id?: string): string {
  if (scope === "global") {
    return id ? `/board/global/${id}` : "/board/global";
  }
  return id ? `/servers/active/board/${id}` : "/servers/active/board";
}

function BoardEntryList({
  entries,
  canEdit,
  busy,
  onEdit,
  onDelete,
}: {
  entries: TeamBoardEntry[];
  canEdit: boolean;
  busy: string | null;
  onEdit: (entry: TeamBoardEntry) => void;
  onDelete: (entry: TeamBoardEntry) => void;
}) {
  const groups = useMemo(() => groupTeamBoardEntries(entries), [entries]);
  if (groups.length === 0) return null;

  return (
    <div className="team-board-groups">
      {groups.map((group) => (
        <section key={group.category || "__uncategorized"} className="team-board-group">
          <h3 className="team-board-group-title">{group.label}</h3>
          <ul className="team-board-list">
            {group.entries.map((entry) => (
              <li key={entry.id} className="card team-board-item">
                <div className="team-board-item-header">
                  <div>
                    <span className={`team-board-kind team-board-kind-${entry.kind}`}>
                      {entry.kind === "link" ? "Link" : "Note"}
                    </span>
                    {entry.pinned && <span className="badge">Pinned</span>}
                    <h4>{entry.title}</h4>
                  </div>
                  {canEdit && (
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={busy !== null}
                        onClick={() => onEdit(entry)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={busy !== null}
                        onClick={() => void onDelete(entry)}
                      >
                        {busy === entry.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  )}
                </div>
                {entry.kind === "link" ? (
                  <p>
                    <a href={entry.content} target="_blank" rel="noopener noreferrer">
                      {entry.content}
                    </a>
                  </p>
                ) : (
                  <p className="team-board-note">{entry.content}</p>
                )}
                <p className="muted team-board-meta">
                  Added by {entry.createdBy} · updated {new Date(entry.updatedAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function TeamBoardPage() {
  const canEdit = useCan("switch");
  const { epoch } = useActiveServer();
  const [globalEntries, setGlobalEntries] = useState<TeamBoardEntry[]>([]);
  const [serverEntries, setServerEntries] = useState<TeamBoardEntry[]>([]);
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formScope, setFormScope] = useState<BoardScope>("global");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [globalData, serverData] = await Promise.all([
        apiFetch<{ entries: TeamBoardEntry[] }>("/board/global"),
        apiFetch<{ entries: TeamBoardEntry[] }>("/servers/active/board"),
      ]);
      setGlobalEntries(globalData.entries);
      setServerEntries(serverData.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load team board");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, epoch]);

  const allCategories = useMemo(
    () => collectTeamBoardCategories([...globalEntries, ...serverEntries]),
    [globalEntries, serverEntries],
  );

  const visibleGlobal = useMemo(
    () => filterEntries(globalEntries, filter, categoryFilter),
    [globalEntries, filter, categoryFilter],
  );
  const visibleServer = useMemo(
    () => filterEntries(serverEntries, filter, categoryFilter),
    [serverEntries, filter, categoryFilter],
  );

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
  };

  const openCreate = (scope: BoardScope) => {
    setFormScope(scope);
    setForm({
      ...EMPTY_FORM,
      category: categoryFilter,
    });
    setEditingId(null);
    setShowForm(true);
    setMessage(null);
    setError(null);
  };

  const startEdit = (scope: BoardScope, entry: TeamBoardEntry) => {
    setFormScope(scope);
    setEditingId(entry.id);
    setForm({
      kind: entry.kind,
      title: entry.title,
      content: entry.content,
      category: entry.category,
      pinned: entry.pinned,
    });
    setShowForm(true);
    setMessage(null);
    setError(null);
  };

  const saveEntry = async () => {
    setBusy("save");
    setError(null);
    setMessage(null);
    try {
      if (editingId) {
        await apiFetch(boardApiPath(formScope, editingId), {
          method: "PATCH",
          body: JSON.stringify(form),
        });
        setMessage("Entry updated.");
      } else {
        await apiFetch(boardApiPath(formScope), {
          method: "POST",
          body: JSON.stringify(form),
        });
        setMessage(formScope === "global" ? "General entry added." : "Server entry added.");
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save entry");
    } finally {
      setBusy(null);
    }
  };

  const deleteEntry = async (scope: BoardScope, entry: TeamBoardEntry) => {
    if (!window.confirm(`Delete "${entry.title}"?`)) return;
    setBusy(entry.id);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(boardApiPath(scope, entry.id), { method: "DELETE" });
      setMessage("Entry deleted.");
      if (editingId === entry.id) resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete entry");
    } finally {
      setBusy(null);
    }
  };

  const emptyLabel =
    filter === "all" ? "No notes or links yet." : filter === "note" ? "No notes yet." : "No links yet.";

  return (
    <div>
      <header className="page-header">
        <h1>Team board</h1>
        <p>
          Shared notes and links for your team. <strong>General</strong> entries apply everywhere;
          <strong> server</strong> entries are tied to the active Rust server. Use categories to group
          related items.
        </p>
      </header>

      <div className="team-board-filters">
        <nav className="page-tabs">
          {(["all", "note", "link"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={filter === tab ? "btn-primary" : "btn-secondary"}
              onClick={() => setFilter(tab)}
            >
              {tab === "all" ? "All" : tab === "note" ? "Notes" : "Links"}
            </button>
          ))}
        </nav>
        <label className="team-board-category-filter">
          Category
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All categories</option>
            {allCategories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-ok">{message}</div>}

      {canEdit && showForm && (
        <section className="card team-board-compose">
          <h2>
            {editingId ? "Edit entry" : "New entry"}
            {!editingId && (formScope === "global" ? " (general)" : " (this server)")}
          </h2>
          {!editingId && (
            <div className="form-row">
              <label>
                Save to
                <select
                  value={formScope}
                  onChange={(e) => setFormScope(e.target.value as BoardScope)}
                >
                  <option value="global">General — all servers</option>
                  <option value="server">This server only</option>
                </select>
              </label>
            </div>
          )}
          <div className="form-row">
            <label>
              Type
              <select
                value={form.kind}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, kind: e.target.value as TeamBoardEntryKind }))
                }
              >
                <option value="note">Note</option>
                <option value="link">Link</option>
              </select>
            </label>
            <label>
              Category
              <input
                list="team-board-categories"
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                placeholder="Raid, Codes, Links…"
              />
            </label>
            <label>
              Title
              <input
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder={form.kind === "link" ? "Team Discord" : "Recruiting rules"}
              />
            </label>
          </div>
          <datalist id="team-board-categories">
            {allCategories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
          <label>
            {form.kind === "link" ? "URL" : "Note"}
            {form.kind === "link" ? (
              <input
                type="url"
                value={form.content}
                onChange={(e) => setForm((prev) => ({ ...prev, content: e.target.value }))}
                placeholder="https://discord.gg/…"
              />
            ) : (
              <textarea
                rows={5}
                value={form.content}
                onChange={(e) => setForm((prev) => ({ ...prev, content: e.target.value }))}
                placeholder="Be respectful in comms. Raid nights are Fri/Sat 8pm ET."
              />
            )}
          </label>
          {form.category.trim() && (
            <p className="muted team-board-category-preview">
              Category: <strong>{teamBoardCategoryLabel(form.category)}</strong>
            </p>
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.pinned}
              onChange={(e) => setForm((prev) => ({ ...prev, pinned: e.target.checked }))}
            />
            Pin to top
          </label>
          <div className="btn-row">
            <button
              type="button"
              className="btn-primary"
              disabled={busy === "save" || !form.title.trim() || !form.content.trim()}
              onClick={() => void saveEntry()}
            >
              {busy === "save" ? "Saving…" : editingId ? "Save changes" : "Add entry"}
            </button>
            <button type="button" className="btn-secondary" onClick={resetForm}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <section className="team-board-section">
            <div className="team-board-section-header">
              <div>
                <h2>General</h2>
                <p className="muted">Team-wide notes and links — not tied to a specific server.</p>
              </div>
              {canEdit && !showForm && (
                <button type="button" className="btn-secondary" onClick={() => openCreate("global")}>
                  Add general entry
                </button>
              )}
            </div>
            {visibleGlobal.length === 0 ? (
              <section className="card">
                <p className="muted">
                  {emptyLabel}
                  {categoryFilter ? ` Nothing in “${categoryFilter}”.` : ""}
                  {canEdit ? " Add a general entry for the team." : ""}
                </p>
              </section>
            ) : (
              <BoardEntryList
                entries={visibleGlobal}
                canEdit={canEdit}
                busy={busy}
                onEdit={(entry) => startEdit("global", entry)}
                onDelete={(entry) => void deleteEntry("global", entry)}
              />
            )}
          </section>

          <section className="team-board-section">
            <div className="team-board-section-header">
              <div>
                <h2>This server</h2>
                <p className="muted">Notes and links for the currently active Rust server.</p>
              </div>
              {canEdit && !showForm && (
                <button type="button" className="btn-secondary" onClick={() => openCreate("server")}>
                  Add server entry
                </button>
              )}
            </div>
            {visibleServer.length === 0 ? (
              <section className="card">
                <p className="muted">
                  {emptyLabel}
                  {categoryFilter ? ` Nothing in “${categoryFilter}”.` : ""}
                  {canEdit ? " Add a server-specific entry." : ""}
                </p>
              </section>
            ) : (
              <BoardEntryList
                entries={visibleServer}
                canEdit={canEdit}
                busy={busy}
                onEdit={(entry) => startEdit("server", entry)}
                onDelete={(entry) => void deleteEntry("server", entry)}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
