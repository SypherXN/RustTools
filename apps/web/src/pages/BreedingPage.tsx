import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BreedingEntry, BreedingEntryInput, BreedingKind } from "@rusttools/shared";
import { apiFetch } from "../lib/api";
import { useCan } from "../hooks/usePermissions";
import { breedingById, isBreedingAvailable } from "../lib/breeding-utils";
import { BreedingEntryCard } from "../components/BreedingEntryCard";
import { BreedingEntryForm } from "../components/BreedingEntryForm";
import { CropCrossCalculator, type CalculatorPreset } from "../components/CropCrossCalculator";
import "./breeding.css";

type KindFilter = "all" | "crop" | "animal";

export function BreedingPage() {
  const canEdit = useCan("switch");
  const [entries, setEntries] = useState<BreedingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [searchText, setSearchText] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState("");
  const [serverFilter, setServerFilter] = useState("");
  const [hideUnavailable, setHideUnavailable] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BreedingEntry | null>(null);
  const [createKind, setCreateKind] = useState<BreedingKind>("crop");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [preset, setPreset] = useState<CalculatorPreset | null>(null);
  const poolFingerprint = useRef("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiFetch<{ entries: BreedingEntry[] }>("/breeding");
      // Skip identical payloads so the 30s poll doesn't churn state (and
      // doesn't invalidate calculator results) when nothing changed.
      const fingerprint = JSON.stringify(data.entries);
      if (fingerprint !== poolFingerprint.current) {
        poolFingerprint.current = fingerprint;
        setEntries(data.entries);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load breeding pool");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const entryById = useMemo(() => breedingById(entries), [entries]);

  const visuallyAvailable = useCallback(
    (entry: BreedingEntry) => !hideUnavailable || isBreedingAvailable(entry),
    [hideUnavailable],
  );

  const visible = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return entries
      .filter((entry) => {
        if (kindFilter !== "all" && entry.kind !== kindFilter) return false;
        if (!visuallyAvailable(entry)) return false;
        if (speciesFilter && entry.species !== speciesFilter) return false;
        if (serverFilter && entry.serverLabel !== serverFilter) return false;
        if (
          query &&
          !entry.name.toLowerCase().includes(query) &&
          !entry.species.toLowerCase().includes(query) &&
          !entry.serverLabel.toLowerCase().includes(query) &&
          !entry.genes.toLowerCase().includes(query)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "crop" ? -1 : 1;
        if (a.species !== b.species) return a.species.localeCompare(b.species);
        return a.name.localeCompare(b.name);
      });
  }, [entries, kindFilter, visuallyAvailable, speciesFilter, serverFilter, searchText]);

  const crops = visible.filter((entry) => entry.kind === "crop");
  const animals = visible.filter((entry) => entry.kind === "animal");

  const speciesOptions = useMemo(
    () => [...new Set(entries.map((entry) => entry.species))].sort(),
    [entries],
  );
  const serverOptions = useMemo(
    () => [...new Set(entries.map((entry) => entry.serverLabel))].sort(),
    [entries],
  );

  const resetForm = () => {
    setShowForm(false);
    setEditing(null);
    setFormError(null);
  };

  const openCreate = (kind: BreedingKind) => {
    setEditing(null);
    setCreateKind(kind);
    setFormError(null);
    setShowForm(true);
  };

  const startEdit = (entry: BreedingEntry) => {
    setCreateKind(entry.kind);
    setEditing(entry);
    setFormError(null);
    setShowForm(true);
  };

  const saveEntry = async (input: BreedingEntryInput): Promise<boolean> => {
    setBusy("save");
    setError(null);
    setFormError(null);
    try {
      if (editing) {
        await apiFetch(`/breeding/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(input),
        });
        setMessage("Entry updated.");
      } else {
        await apiFetch("/breeding", { method: "POST", body: JSON.stringify(input) });
        setMessage(input.kind === "crop" ? "Crop seed added." : "Animal added.");
      }
      resetForm();
      await load(true);
      return true;
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save entry");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const deleteEntry = async (entry: BreedingEntry) => {
    if (!window.confirm(`Delete "${entry.name}"? Any offspring links to it are cleared.`)) return;
    setBusy(entry.id);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(`/breeding/${entry.id}`, { method: "DELETE" });
      setMessage(`"${entry.name}" deleted.`);
      if (editing?.id === entry.id) resetForm();
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete entry");
    } finally {
      setBusy(null);
    }
  };

  const pushPreset = (patch: Omit<CalculatorPreset, "id">) => {
    setPreset((prev) => ({ ...patch, id: (prev?.id ?? 0) + 1 }));
  };

  const useAsCentre = (entry: BreedingEntry) => {
    pushPreset({
      centre: entry.genes,
      donor: null,
      species: entry.species,
      serverLabel: entry.serverLabel,
    });
    setMessage(`“${entry.name}” loaded as the calculator's centre (${entry.species}, ${entry.serverLabel}).`);
  };

  const useAsDonor = (entry: BreedingEntry) => {
    pushPreset({
      centre: null,
      donor: entry.genes,
      species: entry.species,
      serverLabel: entry.serverLabel,
    });
    setMessage(`“${entry.name}” added as a donor line (${entry.species}, ${entry.serverLabel}).`);
  };

  const cardProps = {
    entries,
    canEdit,
    busyId: busy,
    onEdit: startEdit,
    onDelete: (entry: BreedingEntry) => void deleteEntry(entry),
    onUseAsCentre: useAsCentre,
    onUseAsDonor: useAsDonor,
  };

  return (
    <div>
      <header className="page-header">
        <h1>Farming</h1>
        <p>
          Manual crop planner and cow/sheep tracker. The shared breeding pool is visible to the whole
          team — record seeds with genes, animals with lineage, and where to pick them up. Animals
          are tracked by <strong>observed traits and recorded lineage only</strong>; this page does
          not predict inheritance.
        </p>
      </header>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {message && <div className="alert alert-ok">{message}</div>}

      {canEdit && showForm && (
        <BreedingEntryForm
          key={editing ? editing.id : `create-${createKind}`}
          entries={entries}
          editing={editing}
          defaultKind={createKind}
          busy={busy === "save"}
          serverError={formError}
          onSave={saveEntry}
          onCancel={resetForm}
        />
      )}

      <CropCrossCalculator allEntries={entries} preset={preset} />

      <section className="card breeding-toolbar">
        <nav className="page-tabs" aria-label="Kind filter">
          {(["all", "crop", "animal"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={kindFilter === tab ? "btn-primary" : "btn-secondary"}
              onClick={() => setKindFilter(tab)}
            >
              {tab === "all" ? "All" : tab === "crop" ? "Crops" : "Animals"}
            </button>
          ))}
        </nav>
        <label className="breeding-field">
          Search
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="name, species, server, genes…"
          />
        </label>
        <label className="breeding-field">
          Species
          <select value={speciesFilter} onChange={(e) => setSpeciesFilter(e.target.value)}>
            <option value="">All species</option>
            {speciesOptions.map((species) => (
              <option key={species} value={species}>{species}</option>
            ))}
          </select>
        </label>
        <label className="breeding-field">
          Server
          <select value={serverFilter} onChange={(e) => setServerFilter(e.target.value)}>
            <option value="">All servers</option>
            {serverOptions.map((label) => (
              <option key={label} value={label}>{label}</option>
            ))}
          </select>
        </label>
        <label className="checkbox-label breeding-availability-toggle">
          <input
            type="checkbox"
            checked={hideUnavailable}
            onChange={(e) => setHideUnavailable(e.target.checked)}
          />
          Hide unavailable
        </label>
        <div className="btn-row breeding-toolbar-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          {canEdit && (
            <>
              <button type="button" className="btn-secondary" onClick={() => openCreate("crop")}>
                + Add crop
              </button>
              <button type="button" className="btn-secondary" onClick={() => openCreate("animal")}>
                + Add animal
              </button>
            </>
          )}
        </div>
      </section>

      {loading ? (
        <p className="muted">Loading pool…</p>
      ) : (
        <>
          {(kindFilter === "all" || kindFilter === "crop") && (
            <section className="breeding-section">
              <h2>Crops <span className="muted breeding-count">({crops.length} shown)</span></h2>
              {crops.length === 0 ? (
                <section className="card"><p className="muted">No crops match what you're filtering for.</p></section>
              ) : (
                <ul className="breeding-list">
                  {crops.map((entry) => (
                    <BreedingEntryCard key={entry.id} entry={entry} {...cardProps} />
                  ))}
                </ul>
              )}
            </section>
          )}
          {(kindFilter === "all" || kindFilter === "animal") && (
            <section className="breeding-section">
              <h2>Animals <span className="muted breeding-count">({animals.length} shown)</span></h2>
              {animals.length === 0 ? (
                <section className="card"><p className="muted">No animals match what you're filtering for.</p></section>
              ) : (
                <ul className="breeding-list">
                  {animals.map((entry) => (
                    <BreedingEntryCard key={entry.id} entry={entry} {...cardProps} />
                  ))}
                </ul>
              )}
            </section>
          )}
          <p className="muted breeding-count-note">
            {entryById.size} records · auto-refreshes every 30 s
          </p>
        </>
      )}
    </div>
  );
}
