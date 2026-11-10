import { useEffect, useMemo, useState } from "react";
import type { BreedingEntry } from "@rusttools/shared";
import {
  cropTargetStatus,
  findTwoDonorCrosses,
  isValidCropGenes,
  planCropPath,
  simulateCropCross,
  type CropCrossResult,
  type CropCrossSearch,
  type CropPathPlan,
  type CropPathStep,
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
  const [maxGenerations, setMaxGenerations] = useState("5");
  const [maxDonors, setMaxDonors] = useState("2");
  const [minutesPerGeneration, setMinutesPerGeneration] = useState("");
  const [path, setPath] = useState<{ result: CropPathPlan | null; error: string | null }>({ result: null, error: null });

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
    setPath({ result: null, error: null });
  }, [allEntries, preset, species, serverLabel, centre, donorsText, target, anyOrder, maxGenerations, maxDonors, minutesPerGeneration]);

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

  const runPath = () => {
    setPath({ result: null, error: null });
    if (speciesRequired) { setPath({ result: null, error: "Pick a species first." }); return; }
    if (!serverLabel) { setPath({ result: null, error: "Pick a server + wipe to search the shared pool." }); return; }
    if (!isValidCropGenes(target)) { setPath({ result: null, error: "Target must be six letters from G, Y, H, W, X." }); return; }
    const generations = Number(maxGenerations);
    const donors = Number(maxDonors);
    const minutes = minutesPerGeneration.trim() === "" ? null : Number(minutesPerGeneration);
    if (!Number.isInteger(generations) || generations < 1 || generations > 8) {
      setPath({ result: null, error: "Max generations must be a whole number from 1 to 8." });
      return;
    }
    if (!Number.isInteger(donors) || donors < 1 || donors > 3) {
      setPath({ result: null, error: "Max donors must be a whole number from 1 to 3." });
      return;
    }
    if (minutes !== null && (!Number.isFinite(minutes) || minutes < 0)) {
      setPath({ result: null, error: "Minutes per generation must be a non-negative number, or blank to skip the estimate." });
      return;
    }
    try {
      const plan = planCropPath(searchPool, target, anyOrder, { maxGenerations: generations, maxDonors: donors });
      setPath({ result: plan, error: null });
    } catch (err) {
      setPath({ result: null, error: err instanceof Error ? err.message : "Fastest-path search failed." });
    }
  };

  const renderRoute = (title: string, steps: CropPathStep[], strains: CropPathPlan["startingStrains"]) => {
    if (steps.length === 0) return null;
    return (
      <>
        <h4>{title}</h4>
        <ul className="breeding-strains">
          {strains.map((strain) => (
            <li key={strain.genome} className="breeding-strain">
              <GeneStrip genes={strain.genome} />
              <span className="breeding-strain-meta">
                {strain.poolIds
                  .map((id) => {
                    const entry = entryById.get(id);
                    return entry ? `${entry.name} (${entry.location})` : id;
                  })
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
        <ol className="breeding-path-steps">
          {steps.map((step, index) => (
            <li key={`${step.generation}-${index}`} className="breeding-path-step">
              <div className="breeding-plan-row">
                <span className="breeding-path-gen">Generation {step.generation}</span>
                <span>
                  Centre <GeneStrip genes={step.centre} />
                  {describeGenome(step.centre, steps, index) && (
                    <span className="breeding-strain-meta"> {describeGenome(step.centre, steps, index)}</span>
                  )}
                </span>
                <span>
                  Donors{" "}
                  {step.donors.map((donor, donorIndex) => {
                    const donorTag = describeGenome(donor, steps, index);
                    return (
                      <span key={`${index}-${donorIndex}`} className="breeding-path-donor">
                        <GeneStrip genes={donor} />
                        {donorTag && <span className="breeding-strain-meta">{donorTag}</span>}
                      </span>
                    );
                  })}
                </span>
                <span className="breeding-path-arrow">
                  → <GeneStrip genes={step.result} />
                </span>
              </div>
            </li>
          ))}
        </ol>
      </>
    );
  };

  const manualStatus = manual.result
    ? isValidCropGenes(target)
      ? cropTargetStatus(manual.result, target, anyOrder)
      : null
    : null;

  // Genome → "Name (pickup)" tag for every pool entry in the current scope.
  // Multiple entries sharing a genome are chained with " · ".
  const strainTags = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of searchPool) {
      const entry0 = entryById.get(entry.id);
      const tag = entry0 ? `${entry0.name} (${entry0.location})` : entry.id;
      map.set(entry.genes, map.has(entry.genes) ? `${map.get(entry.genes)} · ${tag}` : tag);
    }
    return map;
  }, [searchPool, entryById]);

  // Pool name when known, otherwise "produced in generation k" for intermediates.
  const describeGenome = (genome: string, steps: CropPathStep[], index: number): string => {
    const poolTag = strainTags.get(genome);
    if (poolTag) return poolTag;
    for (let i = 0; i < index; i += 1) {
      const prior = steps[i];
      if (prior !== undefined && prior.result === genome) return `produced in generation ${prior.generation}`;
    }
    return "";
  };

  return (
    <section className="card breeding-calculator">
      <h2>Crop cross planner</h2>
      <p className="muted">
        Manual calculator for one cross at a time — centre seed plus donor genes. Tied slots are
        listed as options, never probabilities; the game's tie-break is undocumented in the
        sources. Animals are not planned here — cow/sheep inheritance is undocumented, so animal
        records stay observational.
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
        <button type="button" className="btn-secondary" onClick={runPath}>
          Find fastest path
        </button>
      </div>

      <div className="breeding-path-row">
        <label className="breeding-field breeding-numfield">
          Max generations (1–8)
          <input
            type="number"
            inputMode="numeric"
            aria-label="Max generations for the fastest-path search, 1 to 8"
            min={1}
            max={8}
            value={maxGenerations}
            onChange={(e) => setMaxGenerations(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </label>
        <label className="breeding-field breeding-numfield">
          Max donors (1–3)
          <input
            type="number"
            inputMode="numeric"
            aria-label="Max donors per cross in the fastest-path search, 1 to 3"
            min={1}
            max={3}
            value={maxDonors}
            onChange={(e) => setMaxDonors(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </label>
        <label className="breeding-field breeding-numfield">
          Minutes per generation (your measured value, optional)
          <input
            type="number"
            inputMode="decimal"
            aria-label="Your measured minutes per generation, used only for a total time estimate"
            min={0}
            step="any"
            value={minutesPerGeneration}
            onChange={(e) => setMinutesPerGeneration(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="e.g. 12"
          />
        </label>
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

      {path.error && <div className="alert alert-error">{path.error}</div>}
      {path.result && (
        <div className="breeding-result">
          <h3>
            Fastest path to {target}
            {anyOrder ? " (any slot order)" : ""} — {path.result.limits.maxGenerations} generations ×{" "}
            {path.result.limits.maxDonors} donors
          </h3>
          {path.result.found ? (
            <p className="breeding-status breeding-status-ok">
              Target reachable in {path.result.generations} generation
              {path.result.generations === 1 ? "" : "s"} and {path.result.crosses} cross
              {path.result.crosses === 1 ? "" : "es"}.
              {minutesPerGeneration.trim() !== "" && Number(minutesPerGeneration) >= 0 && (
                <span className="breeding-strain-meta">
                  {" "}Estimated total ≈ {Math.round(Number(minutesPerGeneration) * path.result.generations)} min at
                  your measured {minutesPerGeneration} min per generation.
                </span>
              )}
            </p>
          ) : (
            <p className="breeding-status breeding-status-warn">
              Not reachable within these limits.
              {path.result.closest && (
                <>
                  {" "}Closest: <strong>{path.result.closest.genome}</strong> — {path.result.closest.matchingSlots}/6
                  slots matched over {path.result.closest.generations} generation
                  {path.result.closest.generations === 1 ? "" : "s"}. Partial route, not the target.
                </>
              )}
            </p>
          )}
          {path.result.limits.truncated && (
            <p className="muted breeding-hint">
              The search hit its {path.result.limits.maxGenerations}-generation ×{" "}
              {path.result.limits.maxDonors}-donor limit, so a faster path may exist.
            </p>
          )}
          {path.result.found &&
            renderRoute("Starting strains to collect from the shared pool", path.result.steps, path.result.startingStrains)}
          {!path.result.found && path.result.closest &&
            renderRoute("Closest partial route — not the target", path.result.closest.steps, path.result.closest.startingStrains)}
          <p className="muted breeding-path-note">
            Every planned cross has a certain result — tied slots are never planned through because the game's
            tie-break is undocumented in the sources. Each generation crosses only strains that existed by the end
            of the previous one, assuming clones of any strain you hold. Planting reminders: same planter, same
            species, donors within 1.5 m of the centre.
          </p>
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
        the exact 0.6/1 source weights. The 2-donor search is single-generation;
        the fastest-path planner uses the generation and donor limits you set.
      </p>
    </section>
  );
}
