import { useEffect, useMemo, useRef, useState } from "react";
import {
  ANIMAL_GRADES,
  ANIMAL_TRAITS,
  expressedGrade,
  type AnimalGrade,
  type AnimalTrait,
  type BreedingKind,
  type BreedingSex,
} from "@rusttools/shared";
import {
  animalGenotypeFromWire,
  breedingPairWarning,
  breedingSexLabel,
  breedingWouldCycle,
  type AnimalGenotypeWire,
  type BreedingWireEntry as BreedingEntry,
  type BreedingWireInput as BreedingEntryInput,
} from "../lib/breeding-utils";

type AlleleDraft = Record<AnimalTrait, { a: AnimalGrade | ""; b: AnimalGrade | "" }>;

function genotypeDraft(entry: BreedingEntry | null): AlleleDraft {
  const model = animalGenotypeFromWire(entry?.kind === "animal" ? entry.animalGenotype : null);
  return {
    dung: model.dung ?? { a: "", b: "" },
    yield: model.yield ?? { a: "", b: "" },
    fertility: model.fertility ?? { a: "", b: "" },
    hardiness: model.hardiness ?? { a: "", b: "" },
  };
}

function draftExpression(pair: AlleleDraft[AnimalTrait]): AnimalGrade | null {
  return pair.a && pair.b ? expressedGrade({ a: pair.a, b: pair.b }) : null;
}

interface FormState {
  kind: BreedingKind;
  name: string;
  species: string;
  serverLabel: string;
  genes: string;
  traits: string;
  quantity: string;
  location: string;
  available: boolean;
  sex: BreedingSex;
  potential: string;
  motherId: string;
  fatherId: string;
  notes: string;
  genotype: AlleleDraft;
  markerA: string;
  markerB: string;
}

function formFromEntry(entry: BreedingEntry | null, defaultKind: BreedingKind): FormState {
  if (!entry) {
    return {
      kind: defaultKind,
      name: "",
      species: "",
      serverLabel: "",
      genes: "",
      traits: "",
      quantity: "1",
      location: "",
      available: true,
      sex: "unknown",
      potential: "",
      motherId: "",
      fatherId: "",
      notes: "",
      genotype: genotypeDraft(null),
      markerA: "",
      markerB: "",
    };
  }
  return {
    kind: entry.kind,
    name: entry.name,
    species: entry.species,
    serverLabel: entry.serverLabel,
    genes: entry.genes,
    traits: entry.traits,
    quantity: String(entry.quantity),
    location: entry.location,
    available: entry.available,
    sex: entry.sex,
    potential: entry.potential,
    motherId: entry.motherId ?? "",
    fatherId: entry.fatherId ?? "",
    notes: entry.notes,
    genotype: genotypeDraft(entry),
    markerA: entry.kind === "animal" ? entry.animalGenotype?.markers?.[0] ?? "" : "",
    markerB: entry.kind === "animal" ? entry.animalGenotype?.markers?.[1] ?? "" : "",
  };
}

export function BreedingEntryForm({
  entries,
  editing,
  defaultKind,
  busy,
  serverError,
  onSave,
  onCancel,
}: {
  entries: BreedingEntry[];
  editing: BreedingEntry | null;
  defaultKind: BreedingKind;
  busy: boolean;
  serverError: string | null;
  onSave: (input: BreedingEntryInput) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => formFromEntry(editing, defaultKind));
  const [localError, setLocalError] = useState<string | null>(null);
  const [formNote, setFormNote] = useState<string | null>(null);
  const lineageScopeRef = useRef<string>("");
  const incompleteTrait = ANIMAL_TRAITS.find((trait) =>
    Boolean(form.genotype[trait].a) !== Boolean(form.genotype[trait].b));
  const markerA = form.markerA.trim();
  const markerB = form.markerB.trim();
  const genotypeError = incompleteTrait
    ? `${incompleteTrait}: record both alleles or clear both to Not recorded.`
    : Boolean(markerA) !== Boolean(markerB)
      ? "Record both lineage markers or clear both."
      : null;

  // Lineage selections are scoped to species + serverLabel. When either
  // changes, the option lists move — clear the parents explicitly instead of
  // letting save silently strip the previously chosen lineage.
  useEffect(() => {
    const scope = `${form.kind}|${form.species.trim().toLowerCase()}|${form.serverLabel.trim()}`;
    if (lineageScopeRef.current === "") {
      lineageScopeRef.current = scope;
      return;
    }
    if (lineageScopeRef.current !== scope) {
      if (form.motherId || form.fatherId) {
        setForm((prev) => ({ ...prev, motherId: "", fatherId: "" }));
        setFormNote("Species or server/wipe changed — mother/father selections were cleared instead of being silently dropped.");
      }
      lineageScopeRef.current = scope;
    }
    // Mother/father only matter for whether a clear is needed; scope is the driver.
  }, [form.kind, form.species, form.serverLabel, form.motherId, form.fatherId]);

  const speciesOptions = useMemo(() => {
    const set = new Set<string>();
    for (const entry of entries) if (entry.kind === "crop" && entry.species) set.add(entry.species);
    return [...set].sort();
  }, [entries]);

  const serverOptions = useMemo(() => {
    const set = new Set<string>();
    for (const entry of entries) if (entry.serverLabel) set.add(entry.serverLabel);
    return [...set].sort();
  }, [entries]);

  const parentOptions = useMemo(() => {
    const species = form.species.trim().toLowerCase();
    return entries.filter(
      (entry) =>
        entry.kind === "animal" &&
        entry.species === species &&
        entry.serverLabel === form.serverLabel.trim() &&
        entry.id !== editing?.id,
    );
  }, [entries, form.species, form.serverLabel, editing?.id]);

  const pairWarning = useMemo(
    () =>
      form.kind === "animal" && form.motherId && form.fatherId
        ? breedingPairWarning(entries, form.motherId, form.fatherId)
        : null,
    [entries, form.kind, form.motherId, form.fatherId],
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Kind switch (create mode only) resets kind-specific fields so hidden
  // traits/potential/lineage never survive into the other kind's record.
  const switchKind = (kind: BreedingKind) => {
    if (kind === form.kind) return;
    setLocalError(null);
    setForm((prev) => ({
      ...prev,
      kind,
      species: kind === "animal" ? "cow" : "",
      genes: "",
      traits: "",
      potential: "",
      sex: "unknown",
      motherId: "",
      fatherId: "",
      genotype: genotypeDraft(null),
      markerA: "",
      markerB: "",
    }));
    setFormNote(`Switched to ${kind === "crop" ? "crop seed" : "animal"} — gene, trait, and lineage fields for the other kind were reset.`);
  };

  const save = async () => {
    setLocalError(null);
    if (form.kind === "animal" && genotypeError) {
      setLocalError(genotypeError);
      return;
    }

    const name = form.name.trim();
    const species = form.species.trim().toLowerCase();
    const serverLabel = form.serverLabel.trim();
    const location = form.location.trim();
    if (!name || !species || !serverLabel || !location) {
      setLocalError("Name, species, server/wipe, and pickup location are required.");
      return;
    }

    let quantity = 1;
    if (form.kind === "crop") {
      quantity = Number(form.quantity.trim());
      if (!Number.isInteger(quantity) || quantity < 0) {
        setLocalError("Quantity must be a whole number of 0 or more.");
        return;
      }
    }

    const genes = form.kind === "crop" ? form.genes.trim().toUpperCase() : "";
    if (form.kind === "crop" && !/^[GYHWX]{6}$/.test(genes)) {
      setLocalError("Genes must be exactly six letters from G, Y, H, W, X.");
      return;
    }

    let motherId: string | null = null;
    let fatherId: string | null = null;
    if (form.kind === "animal") {
      const mother = parentOptions.find((entry) => entry.id === form.motherId);
      const father = parentOptions.find((entry) => entry.id === form.fatherId);
      // A selected parent can vanish (e.g. deleted by another user while this
      // form is open). Never silently erase the lineage — make the user reselect.
      if (form.motherId && !mother) {
        setLocalError("The selected mother is no longer in the scoped pool (it may have been deleted) — pick again or choose “Not recorded”.");
        return;
      }
      if (form.fatherId && !father) {
        setLocalError("The selected father is no longer in the scoped pool (it may have been deleted) — pick again or choose “Not recorded”.");
        return;
      }
      if (mother && father && mother.id === father.id) {
        setLocalError("Mother and father must be different entries.");
        return;
      }
      for (const [check, label] of [
        [mother, "Mother"],
        [father, "Father"],
      ] as const) {
        if (!check) continue;
        if (label === "Mother" && check.sex === "male") {
          setLocalError("Mother must be female or unknown sex.");
          return;
        }
        if (label === "Father" && check.sex === "female") {
          setLocalError("Father must be male or unknown sex.");
          return;
        }
        if (editing && breedingWouldCycle(entries, editing.id, check.id)) {
          setLocalError(`${label} would make a lineage cycle.`);
          return;
        }
      }
      motherId = mother?.id ?? null;
      fatherId = father?.id ?? null;
    }

    // Only complete pairs cross the API boundary; blank pairs are explicit nulls
    // so editing can clear previously recorded traits and markers.
    const animalGenotype: AnimalGenotypeWire = { traits: {} };
    if (form.kind === "animal") {
      for (const trait of ANIMAL_TRAITS) {
        const { a, b } = form.genotype[trait];
        animalGenotype.traits[trait] = a && b ? { a, b } : null;
      }
      if (markerA && markerB) animalGenotype.markers = [markerA, markerB];
    }
    const input: BreedingEntryInput = {
      kind: form.kind,
      name,
      species,
      serverLabel,
      genes,
      traits: form.traits.trim(),
      quantity,
      location,
      available: quantity === 0 ? false : form.available,
      sex: form.kind === "animal" ? form.sex : "unknown",
      potential: form.potential.trim(),
      motherId,
      fatherId,
      notes: form.notes.trim(),
      ...(form.kind === "animal" ? { animalGenotype } : {}),
    };
    await onSave(input);
  };

  return (
    <section className="card breeding-compose">
      <h2>{editing ? `Edit ${editing.name}` : "Add breeding entry"}</h2>
      {serverError && <div className="alert alert-error">{serverError}</div>}
      {localError && <div className="alert alert-error">{localError}</div>}

      {!editing && (
        <div className="breeding-kind-tabs" role="group" aria-label="Entry kind">
          {(["crop", "animal"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={form.kind === kind ? "btn-primary" : "btn-secondary"}
              onClick={() => switchKind(kind)}
            >
              {kind === "crop" ? "Crop seed" : "Animal"}
            </button>
          ))}
        </div>
      )}

      <div className="breeding-form-grid">
        <label>
          Name
          <input
            value={form.name}
            maxLength={80}
            onChange={(e) => set("name", e.target.value)}
            placeholder={form.kind === "crop" ? "AAA Hemp" : "Daisy"}
          />
        </label>
        {form.kind === "animal" ? (
          <label>
            Species
            <select value={form.species} onChange={(e) => set("species", e.target.value)}>
              <option value="">Choose…</option>
              <option value="cow">Cow</option>
              <option value="sheep">Sheep</option>
            </select>
          </label>
        ) : (
          <label>
            Species (crop name)
            <input
              list="breeding-species-options"
              value={form.species}
              maxLength={40}
              onChange={(e) => set("species", e.target.value)}
              placeholder="hemp, potato, red berry…"
            />
          </label>
        )}
        <label>
          Server + wipe
          <input
            list="breeding-server-options"
            value={form.serverLabel}
            maxLength={64}
            onChange={(e) => set("serverLabel", e.target.value)}
            placeholder="US West — wipe 4d"
          />
        </label>
        {form.kind === "crop" ? (
          <>
            <label>
              Genes (6 × G Y H W X)
              <input
                className="breeding-genes-input"
                value={form.genes}
                maxLength={6}
                onChange={(e) => set("genes", e.target.value.toUpperCase().replace(/[^GYHWX]/g, ""))}
                placeholder="GGGYYY"
                spellCheck={false}
              />
            </label>
            <label>
              Quantity
              <input
                type="number"
                min={0}
                value={form.quantity}
                onChange={(e) => set("quantity", e.target.value)}
              />
            </label>
          </>
        ) : (
          <label>
            Sex
            <select value={form.sex} onChange={(e) => set("sex", e.target.value as BreedingSex)}>
              <option value="unknown">Unknown</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </label>
        )}
      </div>

      <label>
        Pickup location
        <input
          value={form.location}
          maxLength={200}
          onChange={(e) => set("location", e.target.value)}
          placeholder="Base 2×2 ground floor planter box"
        />
      </label>

      {form.kind === "animal" && (
        <>
          <section className="breeding-genotype" aria-labelledby="breeding-genotype-heading">
            <h3 id="breeding-genotype-heading">Genotype</h3>
            <p className="muted breeding-hint">
              The stronger allele shows; the hidden one is what offspring can inherit.
              Record both alleles for a trait, or leave both not recorded.
            </p>
            {ANIMAL_TRAITS.map((trait) => (
              <fieldset key={trait} className="breeding-genotype-trait">
                <legend>{trait[0].toUpperCase() + trait.slice(1)}</legend>
                <div className="breeding-form-grid">
                  {(["a", "b"] as const).map((allele) => (
                    <label key={allele}>
                      Allele {allele.toUpperCase()}
                      <select
                        aria-label={`${trait} allele ${allele.toUpperCase()}`}
                        aria-describedby="breeding-genotype-error"
                        aria-invalid={Boolean(form.genotype[trait].a) !== Boolean(form.genotype[trait].b)}
                        value={form.genotype[trait][allele]}
                        onChange={(e) => {
                          const value = e.target.value as AnimalGrade | "";
                          setForm((prev) => ({
                            ...prev,
                            genotype: {
                              ...prev.genotype,
                              [trait]: { ...prev.genotype[trait], [allele]: value },
                            },
                          }));
                        }}
                      >
                        <option value="">Not recorded</option>
                        {ANIMAL_GRADES.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                <p className="muted breeding-hint" aria-live="polite">
                  Expressed: {draftExpression(form.genotype[trait]) ?? "not recorded"}
                </p>
              </fieldset>
            ))}
            <p className="breeding-hint" aria-live="polite">
              {ANIMAL_TRAITS.map((trait) =>
                `${trait[0].toUpperCase() + trait.slice(1)} ${draftExpression(form.genotype[trait]) ?? "not recorded"}`,
              ).join(" · ")}
            </p>
            <div className="breeding-form-grid">
              <label>
                Lineage marker A (optional)
                <input value={form.markerA} maxLength={8} onChange={(e) => set("markerA", e.target.value)}
                  aria-describedby="breeding-genotype-error" />
              </label>
              <label>
                Lineage marker B (optional)
                <input value={form.markerB} maxLength={8} onChange={(e) => set("markerB", e.target.value)}
                  aria-describedby="breeding-genotype-error" />
              </label>
            </div>
            <p id="breeding-genotype-error" className="breeding-hint" role="status">
              {genotypeError ?? "Lineage markers: record both or leave both blank (up to 8 characters each)."}
            </p>
          </section>
          <p className="muted breeding-hint" role="note">
            Record observed traits, genotypes, lineage, and pickup notes.
            Herd analysis uses an unverified Rust Lite model, not guaranteed inheritance.
          </p>
          <label>
            Observed traits
            <textarea
              rows={2}
              value={form.traits}
              maxLength={500}
              onChange={(e) => set("traits", e.target.value)}
              placeholder="Docile, darker coat, milked 3× per cycle…"
            />
          </label>
          <label>
            Observed potential (as seen, no invented numbers)
            <input
              value={form.potential}
              maxLength={120}
              onChange={(e) => set("potential", e.target.value)}
              placeholder="e.g. “High milk, steady wool growth”"
            />
          </label>
        </>
      )}
        {form.kind === "animal" && (
        <>
          <div className="breeding-form-grid">
            <label>
              Mother
              <select
                value={form.motherId}
                onChange={(e) => { set("motherId", e.target.value); setFormNote(null); }}
              >
                <option value="">Not recorded</option>
                {parentOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} ({breedingSexLabel(entry)})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Father
              <select
                value={form.fatherId}
                onChange={(e) => { set("fatherId", e.target.value); setFormNote(null); }}
              >
                <option value="">Not recorded</option>
                {parentOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} ({breedingSexLabel(entry)})
                  </option>
                ))}
              </select>
            </label>
          </div>
          {formNote && (
            <p className="muted breeding-hint" role="status">{formNote}</p>
          )}
        </>
      )}

      <label>
        Notes
        <textarea
          rows={2}
          value={form.notes}
          maxLength={1000}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Anything the team should know."
        />
      </label>

      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={form.available}
          onChange={(e) => set("available", e.target.checked)}
        />
        Available to pick up (a quantity of 0 always shows as not available)
      </label>

      {pairWarning && (
        <div className="breeding-warning" role="alert">
          <strong>Related pair:</strong> {pairWarning} Choosing these parents risks inbreeding —
          consider a different father.
        </div>
      )}
      {form.kind === "animal" && form.motherId && form.fatherId && !pairWarning && (
        <p className="muted breeding-hint">
          No known shared ancestry on record — but unrecorded lineage is not proof the pair is
          unrelated.
        </p>
      )}

      <datalist id="breeding-species-options">
        {speciesOptions.map((species) => (
          <option key={species} value={species} />
        ))}
      </datalist>
      <datalist id="breeding-server-options">
        {serverOptions.map((label) => (
          <option key={label} value={label} />
        ))}
      </datalist>

      <div className="btn-row">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : editing ? "Save changes" : "Add entry"}
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
