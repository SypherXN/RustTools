import { useEffect, useMemo, useState } from "react";
import type { BreedingEntry } from "@rusttools/shared";
import {
  cropTargetStatus,
  findTwoDonorCrosses,
  isValidCropGenes,
  simulateCropCross,
  type CropCrossResult,
  type CropCrossSearch,
} from "@rusttools/shared";
import { breedingById, isBreedingAvailable } from "../lib/breeding-utils";
import { GeneStrip } from "./BreedingGenes";

export interface CalculatorPreset {
  id: number;
  centre: string | null;
  donor: string | null;
  species: string;
  serverLabel: string;
}

export function CropCrossCalculator({
  allEntries,
  preset,
}: {
  allEntries: BreedingEntry[];
  preset: CalculatorPreset | null;
}) {
  const [species, setSpecies] = useState("");
  const [serverLabel, setServerLabel] = useState("");
  const [centre, setCentre] = useState("");
  const [donorsText, setDonorsText] = useState("");
  const [target, setTarget] = useState("GGGYYY");
  const [anyOrder, setAnyOrder] = useState(false);
  const [manual, setManual] = useState<{ result: CropCrossResult | null; error: string | null }>({ result: null, error: null });
  const [search, setSearch] = useState<{ result: CropCrossSearch | null; error: string | null }>({ result: null, error: null });
  const [note, setNote] = useState<string | null>(null);

  const cropEntries = useMemo(() => allEntries.filter((entry) => entry.kind === "crop"), [allEntries]);
  const speciesOptions = useMemo(
    () => [...new Set(cropEntries.map((entry) => entry.species))].sort(),
    [cropEntries],
  );
  const serverOptions = useMemo(() => {
    const wanted = species.trim().toLowerCase();
    return [...new Set(cropEntries
      .filter((entry) => !wanted || entry.species === wanted)
      .map((entry) => entry.serverLabel))].sort();
  }, [cropEntries, species]);
  const entryById = useMemo(() => breedingById(allEntries), [allEntries]);

  // "Use as centre / donor" from the pool. First compute the entry's scope;
  // if it differs, clear incompatible centre/donor state, then ALWAYS apply
  // the requested genome (fresh single line on scope change, append/cap only
  // in the same scope).
  useEffect(() => {
    if (!preset) return;
    const sameSpecies = species.trim().toLowerCase() === preset.species.toLowerCase();
    const sameServer = serverLabel === preset.serverLabel;
    const scopeChanged = !sameSpecies || !sameServer;
    if (scopeChanged) {
      setSpecies(preset.species);
      setServerLabel(preset.serverLabel);
      setCentre("");
      setDonorsText("");
      setNote(`Switched to ${preset.species} on “${preset.serverLabel}” — previous centre and donor lines cleared.`);
    }
    if (preset.centre) {
      setCentre(preset.centre);
      if (!scopeChanged) setNote(null);
    } else if (preset.donor) {
      if (scopeChanged) {
        setDonorsText(preset.donor);
      } else if (donorLines.length >= 8) {
        setNote("“Use as donor” was not added — 8 donor lines are already entered. Remove one first.");
      } else {
        setDonorsText((prev) => [...prev.split("\n").map((line) => line.trim()).filter(Boolean), preset.donor!].join("\n"));
        setNote(null);
      }
    }
    setManual({ result: null, error: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  // Any input, preset, or pool change invalidates previously rendered results.
  // The page skips state churn for identical 30s polls so this doesn't flicker.
  useEffect(() => {
    setManual({ result: null, error: null });
    setSearch({ result: null, error: null });
  }, [allEntries, preset, species, serverLabel, centre, donorsText, target, anyOrder]);

  const donorLines = useMemo(
    () => donorsText.split("\n").map((line) => line.trim()).filter(Boolean),
    [donorsText],
  );
  const invalidDonors = donorLines.filter((line) => !isValidCropGenes(line));
  const tooManyDonors = donorLines.length > 8;
  const speciesRequired = !species.trim();

  const searchPool = useMemo(() => {
    const wantedSpecies = species.trim().toLowerCase();
    // Shared search caps itself to the first 50 usable entries (input order =
    // name order here, so the cut is deterministic) and reports truncation.
    return cropEntries
      .filter(
        (entry) =>
          isBreedingAvailable(entry) &&
          isValidCropGenes(entry.genes) &&
          (!wantedSpecies || entry.species === wantedSpecies) &&
          (!serverLabel || entry.serverLabel === serverLabel),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({ id: entry.id, genes: entry.genes, quantity: entry.quantity }));
  }, [cropEntries, species, serverLabel]);

  const runManual = () => {
    setManual({ result: null, error: null });
    if (speciesRequired) { setManual({ result: null, error: "Pick a species first." }); return; }
    if (!isValidCropGenes(centre) || invalidDonors.length || tooManyDonors || donorLines.length < 1) {
      setManual({ result: null, error: "Enter a centre and 1–8 valid donor gene strings (six letters each)." });
      return;
    }
    try {
      setManual({ result: simulateCropCross(centre, donorLines), error: null });
    } catch (err) {
      setManual({ result: null, error: err instanceof Error ? err.message : "Cross failed." });
    }
  };

  const runSearch = () => {
    setSearch({ result: null, error: null });
    if (speciesRequired) { setSearch({ result: null, error: "Pick a species first." }); return; }
    if (!serverLabel) { setSearch({ result: null, error: "Pick a server + wipe to search the shared pool." }); return; }
    if (!isValidCropGenes(target)) { setSearch({ result: null, error: "Target must be six letters from G, Y, H, W, X." }); return; }
    try {
      setSearch({ result: findTwoDonorCrosses(searchPool, target, anyOrder), error: null });
    } catch (err) {
      setSearch({ result: null, error: err instanceof Error ? err.message : "Search failed." });
    }
  };

  const manualStatus = manual.result
    ? isValidCropGenes(target)
      ? cropTargetStatus(manual.result, target, anyOrder)
      : null
    : null;

  return (
    <section className="card breeding-calculator">
      <h2>Crop cross planner</h2>
      <p className="muted">
        Manual calculator for one cross at a time — centre seed plus donor genes. Tied slots are
        listed as options, never probabilities; the game's tie-break is undocumented in the
        sources.
      </p>

      <div className="breeding-form-grid">
        <label>
          Species (required for the same-species warning)
          <input
            list="breeding-calc-species"
            value={species}
            onChange={(e) => {
              const next = e.target.value;
              if (next !== species && (centre || donorsText)) {
                setCentre("");
                setDonorsText("");
                setNote(`Species changed manually — cleared the pooled centre and donor lines; they may belong to “${species || "the previous species"}”.`);
              }
              setSpecies(next);
              setServerLabel("");
            }}
            placeholder="hemp, potato, red berry…"
          />
        </label>
        <label>
          Server + wipe (for pool search)
          <select value={serverLabel} onChange={(e) => setServerLabel(e.target.value)}>
            <option value="">All servers</option>
            {serverOptions.map((label) => (
              <option key={label} value={label}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Centre genes (6 × G Y H W X)
          <input
            className="breeding-genes-input"
            value={centre}
            maxLength={6}
            spellCheck={false}
            onChange={(e) => setCentre(e.target.value.toUpperCase().replace(/[^GYHWX]/g, ""))}
            placeholder="GGGYYY"
          />
        </label>
        <label>
          Target genes
          <input
            className="breeding-genes-input"
            value={target}
            maxLength={6}
            spellCheck={false}
            onChange={(e) => setTarget(e.target.value.toUpperCase().replace(/[^GYHWX]/g, ""))}
          />
        </label>
      </div>
      <datalist id="breeding-calc-species">
        {speciesOptions.map((option) => (<option key={option} value={option} />))}
      </datalist>

      <label>
        Donor genes — one physical donor per line, up to 8
        <textarea
          className="breeding-genes-input"
          rows={8}
          spellCheck={false}
          value={donorsText}
          onChange={(e) => setDonorsText(e.target.value.toUpperCase())}
          placeholder={"YYYHXW\nGGYYYY"}
        />
      </label>
      <p className="muted breeding-hint">
        {donorLines.length} donor{donorLines.length === 1 ? "" : "s"} entered (max 8).
        {invalidDonors.length > 0 && ` Invalid lines: ${invalidDonors.join(", ")}.`}
        {tooManyDonors && " More than 8 donors — reduce to 8 lines before running."}
      </p>
      {note && <p className="muted breeding-hint">{note}</p>}

      <label className="checkbox-label">
        <input type="checkbox" checked={anyOrder} onChange={(e) => setAnyOrder(e.target.checked)} />
        Match the target in any slot order
      </label>

      <div className="btn-row">
        <button type="button" className="btn-primary" onClick={runManual}>Simulate cross</button>
        <button type="button" className="btn-secondary" onClick={runSearch}>
          Find a 2-donor cross in the shared pool
        </button>
      </div>

      {manual.error && <div className="alert alert-error">{manual.error}</div>}
      {manual.result && (
        <div className="breeding-result">
          <div className="breeding-result-row">
            <GeneStrip genes={manual.result.slots} />
            <span
              className={`badge ${manual.result.certain ? "" : "breeding-badge-warn"}`}
            >
              {manual.result.certain
                ? "Certain outcome"
                : `Up to ${manual.result.possibleOutcomes} slot combinations — tied slots`}
            </span>
          </div>
          {manualStatus && (
            <p
              className={`breeding-status ${
                manualStatus.guaranteed
                  ? "breeding-status-ok"
                  : manualStatus.possible
                    ? "breeding-status-warn"
                    : "breeding-status-error"
              }`}
            >
              Target {target.toUpperCase()}
              {anyOrder ? " (any slot order)" : ""}:{" "}
              {manualStatus.guaranteed
                ? "matches the model under these inputs."
                : manualStatus.possible
                  ? "not ruled out by the slot options — tied slots make this uncertain."
                  : "not reachable from these inputs."}
            </p>
          )}
          <ol className="breeding-planting">
            <li>Plant the centre seed in the planter first.</li>
            <li>
              Plant the donors in the <strong>same planter</strong>, each donor within 1.5 m of the
              centre, all the same species.
            </li>
            <li>
              Keep the donors younger — plant them after the centre so they don't reach their
              crossbreed stage first. The simulator assumes donors keep their set genes; only the
              centre's crossbreed is modelled.
            </li>
            <li>Preserve source strains separately — crossing rewrites the centre's genes.</li>
          </ol>
        </div>
      )}

      {search.error && <div className="alert alert-error">{search.error}</div>}
      {search.result && (
        <div className="breeding-result">
          <h3>
            Best crosses for {target}
            {anyOrder ? " (any slot order)" : ""} — {search.result.plans.length} shown,{" "}
            {search.result.evaluated} combination{search.result.evaluated === 1 ? "" : "s"} evaluated
          </h3>
          {search.result.truncated && (
            <p className="muted">
              Search was limited to the first 50 usable seeds of the matching pool. Filter tighter
              to search the rest.
            </p>
          )}
          {search.result.plans.length === 0 ? (
            <p className="muted">
              No centre + 2-donor cross reaches this target among these seeds. One generation, up to
              2 donors per search — plan deeper lineages one cross at a time.
            </p>
          ) : (
            <ol className="breeding-plan-list">
              {search.result.plans.map((plan) => (
                <li key={`${plan.centreId}-${plan.donorIds.join("-")}-${plan.guaranteed ? "g" : "p"}`} className="breeding-plan">
                  <div className="breeding-plan-row">
                    <span>
                      Centre: <strong>{entryById.get(plan.centreId)?.name ?? "removed"}</strong>
                    </span>
                    <span>
                      Donors:{" "}
                      {plan.donorIds
                        .map((id) => entryById.get(id)?.name ?? "removed")
                        .join(" + ")}
                    </span>
                    <span className={`badge ${plan.guaranteed ? "" : "breeding-badge-warn"}`}>
                      {plan.guaranteed ? "Guaranteed" : "Order-dependent"}
                    </span>
                  </div>
                  <GeneStrip genes={plan.result.slots} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      <p className="muted breeding-sources">
        Sources:{" "}
        <a href="https://rustfront.com/genetics" target="_blank" rel="noopener noreferrer">
          rustfront.com/genetics
        </a>{" "}
        ·{" "}
        <a href="https://rust.facepunch.com/news/farming-update" target="_blank" rel="noopener noreferrer">
          Facepunch farming update
        </a>
        . Tied-slot gene outcomes are modelled here as possibilities; the game's
        tie-break is undocumented in these sources. Integer 3/5 weights preserve
        the exact 0.6/1 source weights. One generation, up to 2 donors per
        search.
      </p>
    </section>
  );
}
