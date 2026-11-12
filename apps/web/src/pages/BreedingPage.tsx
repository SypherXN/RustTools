import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ANIMAL_GRADES, type BreedingKind } from "@rusttools/shared";
import { apiFetch } from "../lib/api";
import { useCan } from "../hooks/usePermissions";
import {
  breedingById,
  isBreedingAvailable,
  type AnimalAnalysis,
  type BreedingWireEntry as BreedingEntry,
  type BreedingWireInput as BreedingEntryInput,
} from "../lib/breeding-utils";
import { BreedingEntryCard } from "../components/BreedingEntryCard";
import { BreedingEntryForm } from "../components/BreedingEntryForm";
import { CropCrossCalculator, type CalculatorPreset } from "../components/CropCrossCalculator";
import "./breeding.css";

type KindFilter = "crop" | "animal";

export function BreedingPage() {
  const canEdit = useCan("switch");
  const [entries, setEntries] = useState<BreedingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnimalAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [kindFilter, setKindFilter] = useState<KindFilter>("crop");
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
  const loadRequest = useRef(0);

  const load = useCallback(async (silent = false) => {
    const request = ++loadRequest.current;
    if (!silent) setLoading(true);
    try {
      // apiFetch uses cachedApiFetch; keep analysis on the same poll and write refresh.
      // A failed analysis request must not hide an otherwise usable breeding pool.
      const [poolResult, analysisResult] = await Promise.allSettled([
        apiFetch<{ entries: BreedingEntry[] }>("/breeding"),
        apiFetch<AnimalAnalysis>("/breeding/analysis/animals"),
      ]);
      // An older poll must not overwrite a newer refresh after a save/delete.
      if (request !== loadRequest.current) return;
      // Skip identical payloads so the 30s poll doesn't churn state (and
      // doesn't invalidate calculator results) when nothing changed.
      if (poolResult.status === "fulfilled") {
        const fingerprint = JSON.stringify(poolResult.value.entries);
        if (fingerprint !== poolFingerprint.current) {
          poolFingerprint.current = fingerprint;
          setEntries(poolResult.value.entries);
        }
        setError(null);
      } else {
        setError(poolResult.reason instanceof Error ? poolResult.reason.message : "Failed to load breeding pool");
      }
      if (analysisResult.status === "fulfilled") {
        setAnalysis(analysisResult.value);
        setAnalysisError(null);
      } else {
        setAnalysisError(analysisResult.reason instanceof Error ? analysisResult.reason.message : "Failed to load herd analysis");
      }
    } finally {
      if (request === loadRequest.current) setLoading(false);
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
  }, [entries, visuallyAvailable, speciesFilter, serverFilter, searchText]);

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
          team — record seeds with genes, animals with genotypes and lineage, and where to pick them up.
          Herd analysis compares recorded evidence with an unverified Rust Lite model.
        </p>
      </header>

      <nav className="page-tabs" aria-label="Farming sections">
        {(["crop", "animal"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={kindFilter === tab ? "btn-primary" : "btn-secondary"}
            aria-current={kindFilter === tab ? "page" : undefined}
            onClick={() => {
              if (tab !== kindFilter) {
                if (showForm) resetForm();
                setKindFilter(tab);
              }
            }}
          >
            {tab === "crop" ? `Crops (${crops.length} shown)` : `Animals (${animals.length} shown)`}
          </button>
        ))}
      </nav>

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

      {/* Kept mounted across tabs so a half-built cross survives a look at the herd. */}
      <div hidden={kindFilter !== "crop"}>
        <CropCrossCalculator allEntries={entries} preset={preset} />
      </div>

      {kindFilter === "animal" && <section className="card breeding-section breeding-herd" aria-labelledby="breeding-herd-heading">
        <h2 id="breeding-herd-heading">Herd analysis</h2>
        {analysisError && <p className="alert alert-error" role="alert">{analysisError}</p>}
        {loading && !analysis && <p className="muted">Loading herd analysis…</p>}
        {analysis && (
          <>
            <p>Animals: {analysis.coverage.animals} · With both parents: {analysis.coverage.withBothParents}
              {" · "}Usable births: {analysis.coverage.birthsUsable}</p>
            <p>Pairs — related: {analysis.relatedPairs.related} · unrelated: {analysis.relatedPairs.unrelated}
              {" · "}unknown: {analysis.relatedPairs.unknown}</p>
            {analysis.coverage.birthsUsable === 0 && (
              <p className="muted">Record animals with parents and genotypes to build evidence.</p>
            )}
            <p className="muted breeding-hint">Model: {analysis.model.version}</p>
            <dl className="breeding-meta">
              {analysis.perTrait.map(({ trait, expressed, predicted, sampleSize }) => (
                <div key={trait} className="breeding-meta-wide">
                  <dt>{trait}</dt>
                  <dd>
                    <p className="breeding-hint">
                      Observed: {ANIMAL_GRADES.map((grade) => `${grade} ${expressed[grade]}`).join(" · ")}
                    </p>
                    {predicted !== null ? (
                      <p className="breeding-hint">
                        model estimate — {analysis.model.version} (expected counts): {ANIMAL_GRADES.map((grade) =>
                          `${grade} ${(predicted[grade] * sampleSize).toFixed(1)}`,
                        ).join(" · ")}
                      </p>
                    ) : (
                      <p className="muted breeding-hint">needs 30 usable births ({sampleSize} so far)</p>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <ul className="muted breeding-hint">
              {analysis.notes.map((note, index) => <li key={index}>{note}</li>)}
            </ul>
          </>
        )}
        <p className="muted breeding-hint">
          Rust Lite model: priors and inbreeding multiplier are unverified soft parameters;
          counts instead of percentages until enough evidence.
        </p>
      </section>}

      <section className="card breeding-toolbar">
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
            <button type="button" className="btn-secondary" onClick={() => openCreate(kindFilter)}>
              {kindFilter === "crop" ? "+ Add crop" : "+ Add animal"}
            </button>
          )}
        </div>
      </section>

      {loading ? (
        <p className="muted">Loading pool…</p>
      ) : (
        <>
          {kindFilter === "crop" && (
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
          {kindFilter === "animal" && (
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
