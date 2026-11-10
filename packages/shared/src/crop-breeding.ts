export type CropGene = "G" | "Y" | "H" | "W" | "X";

export interface CropCrossResult {
  slots: CropGene[][];
  genome: string | null;
  possibleOutcomes: number;
  certain: boolean;
}

export interface CropPoolEntry {
  id: string;
  genes: string;
  quantity: number;
}

export interface CropCrossPlan {
  centreId: string;
  donorIds: [string, string];
  result: CropCrossResult;
  guaranteed: boolean;
}

export interface CropCrossSearch {
  plans: CropCrossPlan[];
  truncated: boolean;
  evaluated: number;
}

const GENE_ORDER: readonly CropGene[] = ["G", "Y", "H", "W", "X"];
const GENE_PATTERN = /^[GYHWX]{6}$/;
const GENOME_LEN = 6;
const MAX_DONORS = 8;
const MAX_POOL = 50;
const MAX_PLANS = 10;

/** Integer weights (3 = 0.6, 5 = 1.0) keep ties exact. */
function geneWeight(gene: CropGene): number {
  return gene === "W" || gene === "X" ? 5 : 3;
}

function normalizeGenome(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const genome = value.trim().toUpperCase();
  if (!GENE_PATTERN.test(genome)) {
    throw new Error(`${label} must be exactly 6 genes from GYHWX`);
  }
  return genome;
}

function countGenes(genome: string): number[] {
  const counts = [0, 0, 0, 0, 0];
  for (const gene of genome) counts[GENE_ORDER.indexOf(gene as CropGene)]++;
  return counts;
}

export function simulateCropCross(centre: string, donors: string[]): CropCrossResult {
  const centreGenome = normalizeGenome(centre, "centre");
  if (!Array.isArray(donors)) throw new Error("donors must be an array of genomes");
  if (donors.length > MAX_DONORS) {
    throw new Error(`donors accepts at most ${MAX_DONORS} genomes (got ${donors.length})`);
  }
  const donorGenomes = donors.map((donor, index) => normalizeGenome(donor, `donor ${index + 1}`));
  const slots: CropGene[][] = [];
  let possibleOutcomes = 1;
  for (let slot = 0; slot < GENOME_LEN; slot++) {
    const centreGene = centreGenome[slot] as CropGene;
    const totals = new Map<CropGene, number>();
    for (const donor of donorGenomes) {
      const gene = donor[slot] as CropGene;
      totals.set(gene, (totals.get(gene) ?? 0) + geneWeight(gene));
    }
    let best = 0;
    for (const total of totals.values()) if (total > best) best = total;
    const options =
      best > geneWeight(centreGene)
        ? GENE_ORDER.filter((gene) => (totals.get(gene) ?? 0) === best)
        : [centreGene];
    slots.push([...options]);
    possibleOutcomes *= options.length;
  }
  const certain = slots.every((options) => options.length === 1);
  return {
    slots,
    genome: certain ? slots.map((options) => options[0]).join("") : null,
    possibleOutcomes,
    certain,
  };
}

function canMatchCounts(slots: CropGene[][], wanted: number[]): boolean {
  const remaining = [...wanted];
  const memo = new Map<string, boolean>();
  const search = (slot: number): boolean => {
    if (slot === GENOME_LEN) return remaining.every((count) => count === 0);
    const key = `${slot}|${remaining.join(",")}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    for (const gene of slots[slot]) {
      const geneIndex = GENE_ORDER.indexOf(gene);
      if (remaining[geneIndex] <= 0) continue;
      remaining[geneIndex]--;
      const ok = search(slot + 1);
      remaining[geneIndex]++;
      if (ok) {
        memo.set(key, true);
        return true;
      }
    }
    memo.set(key, false);
    return false;
  };
  return search(0);
}

export function cropTargetStatus(
  result: CropCrossResult,
  target: string,
  anyOrder: boolean,
): { possible: boolean; guaranteed: boolean } {
  if (!result || !Array.isArray(result.slots) || result.slots.length !== GENOME_LEN) {
    throw new Error("result must be a CropCrossResult with 6 slots");
  }
  if (!result.slots.every((slot) => Array.isArray(slot) && slot.length > 0)) {
    throw new Error("result slots must be non-empty arrays");
  }
  const targetGenome = normalizeGenome(target, "target");
  const singleton = result.slots.every((slot) => slot.length === 1);
  const onlyGenome = singleton ? result.slots.map((slot) => slot[0]).join("") : null;
  if (!anyOrder) {
    const possible = result.slots.every((slot, index) => slot.includes(targetGenome[index] as CropGene));
    return { possible, guaranteed: possible && onlyGenome === targetGenome };
  }
  const targetCounts = countGenes(targetGenome);
  const possible = canMatchCounts(result.slots, targetCounts);
  const guaranteed =
    onlyGenome !== null && countGenes(onlyGenome).every((count, i) => count === targetCounts[i]);
  return { possible, guaranteed };
}

/**
 * Exact single-generation search over two donors. Bounded to the first 50
 * usable entries in input order.
 * ponytail: ceiling is 50 entries and 2 donors; upgrade to indexed/multi-gen
 * search when pools outgrow that.
 */
export function findTwoDonorCrosses(
  pool: { id: string; genes: string; quantity: number }[],
  target: string,
  anyOrder: boolean,
): { plans: CropCrossPlan[]; truncated: boolean; evaluated: number } {
  if (!Array.isArray(pool)) throw new Error("pool must be an array");
  const targetGenome = normalizeGenome(target, "target");
  const seen = new Set<string>();
  const usable: CropPoolEntry[] = [];
  pool.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`pool entry ${index + 1} must be an object`);
    if (typeof entry.id !== "string" || entry.id.trim() === "") {
      throw new Error(`pool entry ${index + 1} needs a non-empty id`);
    }
    const id = entry.id.trim();
    if (seen.has(id)) throw new Error(`duplicate pool id ${JSON.stringify(id)}`);
    seen.add(id);
    if (!Number.isInteger(entry.quantity) || entry.quantity < 0) {
      throw new Error(`pool entry ${JSON.stringify(id)} quantity must be a non-negative integer`);
    }
    const genes = normalizeGenome(entry.genes, `pool entry ${JSON.stringify(id)} genes`);
    if (entry.quantity > 0) usable.push({ id, genes, quantity: entry.quantity });
  });
  const truncated = usable.length > MAX_POOL;
  const candidates = usable.slice(0, MAX_POOL);
  const byId = new Map(candidates.map((entry) => [entry.id, entry]));
  const plans: CropCrossPlan[] = [];
  let evaluated = 0;
  for (const centre of candidates) {
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i; j < candidates.length; j++) {
        const usage = new Map<string, number>();
        for (const entry of [centre, candidates[i], candidates[j]]) {
          usage.set(entry.id, (usage.get(entry.id) ?? 0) + 1);
        }
        let enough = true;
        for (const [id, count] of usage) {
          if ((byId.get(id)?.quantity ?? 0) < count) {
            enough = false;
            break;
          }
        }
        if (!enough) continue;
        evaluated++;
        const result = simulateCropCross(centre.genes, [candidates[i].genes, candidates[j].genes]);
        const status = cropTargetStatus(result, targetGenome, anyOrder);
        if (!status.possible) continue;
        plans.push({
          centreId: centre.id,
          donorIds: [candidates[i].id, candidates[j].id],
          result,
          guaranteed: status.guaranteed,
        });
      }
    }
  }
  plans.sort((a, b) => Number(b.guaranteed) - Number(a.guaranteed));
  return { plans: plans.slice(0, MAX_PLANS), truncated, evaluated };
}

/**
 * Multi-generation crop path planner. A held strain can be cloned, so a genome
 * discovered in an earlier generation is reusable as often as later crosses
 * need; only generation-0 starting strains require quantity > 0.
 */
export interface CropPathStep {
  /** 1-based cross generation. */
  generation: number;
  centre: string;
  donors: string[];
  /** Deterministic result genome; uncertain crosses are never planned. */
  result: string;
}

export interface CropPathOptions {
  /** Default 5, clamped to 1..8. */
  maxGenerations?: number;
  /** Default 2, clamped to 1..3. */
  maxDonors?: number;
}

export interface CropPathPlan {
  found: boolean;
  /** 0 when the target is already in the pool. */
  generations: number;
  /** Distinct planned crosses. */
  crosses: number;
  steps: CropPathStep[];
  startingStrains: { genome: string; poolIds: string[] }[];
  closest: {
    genome: string;
    matchingSlots: number;
    generations: number;
    steps: CropPathStep[];
    startingStrains: { genome: string; poolIds: string[] }[];
  } | null;
  limits: { maxGenerations: number; maxDonors: number; evaluated: number; truncated: boolean };
}

const PATH_DEFAULT_GENERATIONS = 5;
const PATH_DEFAULT_DONORS = 2;
const PATH_MAX_GENERATIONS = 8;
const PATH_MAX_DONOR_OPTION = 3;
const PATH_EVAL_CAP = 200_000;
/** ponytail: total live genomes kept for expansion; drop sets truncated. */
const PATH_KNOWN_CAP = 120;

interface PathRecipe {
  generation: number;
  centre: string;
  donors: string[];
}

function clampPathOption(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function crossKey(centre: string, donors: string[]): string {
  return `${centre}|${[...donors].sort().join("|")}`;
}

function genomeCountsEqual(a: string, b: string): boolean {
  const aCounts = countGenes(a);
  const bCounts = countGenes(b);
  return aCounts.every((count, index) => count === bCounts[index]);
}

function pathMatchingSlots(genome: string, target: string, anyOrder: boolean): number {
  if (!anyOrder) {
    let matches = 0;
    for (let slot = 0; slot < GENOME_LEN; slot++) {
      if (genome[slot] === target[slot]) matches++;
    }
    return matches;
  }
  const genomeCounts = countGenes(genome);
  const targetCounts = countGenes(target);
  return targetCounts.reduce((sum, count, index) => sum + Math.min(count, genomeCounts[index]), 0);
}

/**
 * Bounded, target-directed search. Genomes are kept in a capped frontier and
 * ordered by closeness to the target; dropping any frontier genome can hide a
 * path, so a drop sets `limits.truncated`. Because donor weights are summed by
 * type, a heavy centre gene can still be demoted by several lighter donors, so
 * no stronger pruning is assumed safe.
 */
export function planCropPath(
  pool: { id: string; genes: string; quantity: number }[],
  target: string,
  anyOrder: boolean,
  options?: CropPathOptions,
): CropPathPlan {
  const rawOptions: unknown = options;
  if (rawOptions !== undefined && (rawOptions === null || typeof rawOptions !== "object")) {
    throw new Error("options must be an object");
  }
  const maxGenerations = clampPathOption(
    options?.maxGenerations,
    PATH_DEFAULT_GENERATIONS,
    1,
    PATH_MAX_GENERATIONS,
    "maxGenerations",
  );
  const maxDonors = clampPathOption(
    options?.maxDonors,
    PATH_DEFAULT_DONORS,
    1,
    PATH_MAX_DONOR_OPTION,
    "maxDonors",
  );
  const targetGenome = normalizeGenome(target, "target");
  if (!Array.isArray(pool)) throw new Error("pool must be an array");
  const seen = new Set<string>();
  const usable: CropPoolEntry[] = [];
  pool.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`pool entry ${index + 1} must be an object`);
    if (typeof entry.id !== "string" || entry.id.trim() === "") {
      throw new Error(`pool entry ${index + 1} needs a non-empty id`);
    }
    const id = entry.id.trim();
    if (seen.has(id)) throw new Error(`duplicate pool id ${JSON.stringify(id)}`);
    seen.add(id);
    if (!Number.isInteger(entry.quantity) || entry.quantity < 0) {
      throw new Error(`pool entry ${JSON.stringify(id)} quantity must be a non-negative integer`);
    }
    const genes = normalizeGenome(entry.genes, `pool entry ${JSON.stringify(id)} genes`);
    if (entry.quantity > 0) usable.push({ id, genes, quantity: entry.quantity });
  });
  let truncated = usable.length > MAX_POOL;
  const candidates = usable.slice(0, MAX_POOL);
  const starting = new Map<string, string[]>();
  for (const entry of candidates) {
    const ids = starting.get(entry.genes);
    if (ids) ids.push(entry.id);
    else starting.set(entry.genes, [entry.id]);
  }
  const recipes = new Map<string, PathRecipe | null>();
  const known: string[] = [];
  for (const genome of starting.keys()) {
    recipes.set(genome, null);
    known.push(genome);
  }
  const goalMatch = (genome: string): boolean =>
    genome === targetGenome || (anyOrder && genomeCountsEqual(genome, targetGenome));
  const depthOf = (genome: string): number => recipes.get(genome)?.generation ?? 0;
  const compareKnown = (a: string, b: string): number =>
    pathMatchingSlots(b, targetGenome, anyOrder) - pathMatchingSlots(a, targetGenome, anyOrder) ||
    depthOf(a) - depthOf(b) ||
    a.localeCompare(b);
  const betterRecipe = (a: PathRecipe, b: PathRecipe): boolean => {
    if (a.donors.length !== b.donors.length) return a.donors.length < b.donors.length;
    if (a.centre !== b.centre) return a.centre < b.centre;
    return a.donors.join("|") < b.donors.join("|");
  };
  const limits = { maxGenerations, maxDonors, evaluated: 0, truncated };

  let initial: string | null = null;
  if (starting.has(targetGenome)) initial = targetGenome;
  else if (anyOrder) {
    for (const genome of starting.keys()) {
      if (genomeCountsEqual(genome, targetGenome)) {
        initial = genome;
        break;
      }
    }
  }
  if (initial !== null) {
    return {
      found: true,
      generations: 0,
      crosses: 0,
      steps: [],
      startingStrains: [{ genome: initial, poolIds: [...(starting.get(initial) ?? [])] }],
      closest: null,
      limits,
    };
  }

  let evaluated = 0;
  let stopped = false;
  let foundGenome: string | null = null;
  const best: { current: { genome: string; matchingSlots: number; generation: number } | null } = { current: null };
  const consider = (genome: string, generation: number): void => {
    const score = pathMatchingSlots(genome, targetGenome, anyOrder);
    if (
      best.current === null ||
      score > best.current.matchingSlots ||
      (score === best.current.matchingSlots &&
        (generation < best.current.generation || (generation === best.current.generation && genome < best.current.genome)))
    ) {
      best.current = { genome, matchingSlots: score, generation };
    }
  };
  for (const genome of starting.keys()) consider(genome, 0);

  for (let generation = 1; generation <= maxGenerations; generation++) {
    if (foundGenome !== null) break;
    const snapshot = [...known].sort(compareKnown);
    const discovered = new Set<string>();
    let generationFound: string | null = null;
    let bestTargetDonors = Number.POSITIVE_INFINITY;
    const evaluate = (centre: string, donors: string[]): void => {
      if (stopped) return;
      if (evaluated >= PATH_EVAL_CAP) {
        truncated = true;
        stopped = true;
        return;
      }
      evaluated++;
      const result = simulateCropCross(centre, donors);
      // Tied crosses are undocumented, so they are never planned; this is not a
      // truncation, unlike a frontier/evaluation-cap drop.
      if (!result.certain || result.genome === null) return;
      const genome = result.genome;
      const recipe: PathRecipe = { generation, centre, donors: [...donors].sort() };
      const existing = recipes.get(genome);
      let changed = false;
      if (existing === undefined) {
        recipes.set(genome, recipe);
        changed = true;
      } else if (existing !== null && existing.generation === generation && betterRecipe(recipe, existing)) {
        recipes.set(genome, recipe);
        changed = true;
      }
      if (changed && !goalMatch(genome)) {
        discovered.add(genome);
      }
      if (goalMatch(genome)) {
        // Prefer the smallest donor count within the first reachable generation;
        // same-count alternatives keep the deterministic first/lex recipe.
        if (generationFound === null || recipe.donors.length < bestTargetDonors) {
          generationFound = genome;
          bestTargetDonors = recipe.donors.length;
        }
      }
      consider(genome, generation);
    };
    for (const centre of snapshot) {
      for (let size = 1; size <= maxDonors && !stopped && size < bestTargetDonors; size++) {
        const donors: string[] = [];
        const walk = (start: number): void => {
          if (stopped || (generationFound !== null && size >= bestTargetDonors)) return;
          if (donors.length === size) {
            evaluate(centre, donors);
            return;
          }
          for (let index = start; index < snapshot.length; index++) {
            donors.push(snapshot[index]);
            walk(index);
            donors.pop();
            if (stopped || (generationFound !== null && size >= bestTargetDonors)) return;
          }
        };
        walk(0);
      }
      if (stopped) break;
    }
    if (generationFound !== null) {
      foundGenome = generationFound;
      break;
    }
    if (stopped) break;
    for (const genome of discovered) known.push(genome);
    if (known.length > PATH_KNOWN_CAP) {
      known.sort(compareKnown);
      known.length = PATH_KNOWN_CAP;
      truncated = true;
    }
  }
  limits.evaluated = evaluated;
  limits.truncated = truncated;

  const reconstruct = (
    root: string,
  ): { steps: CropPathStep[]; startingStrains: { genome: string; poolIds: string[] }[]; generations: number; crosses: number } => {
    const stepByCross = new Map<string, CropPathStep>();
    const stepGeneration = new Map<string, number>();
    const usedStarting = new Set<string>();
    const visiting = new Set<string>();
    const visit = (genome: string): number => {
      const cached = stepGeneration.get(genome);
      if (cached !== undefined) return cached;
      if (visiting.has(genome)) throw new Error("cyclic crop path recipe");
      const recipe = recipes.get(genome);
      if (recipe === undefined || recipe === null) {
        usedStarting.add(genome);
        stepGeneration.set(genome, 0);
        return 0;
      }
      visiting.add(genome);
      let dependencyGeneration = visit(recipe.centre);
      for (const donor of recipe.donors) dependencyGeneration = Math.max(dependencyGeneration, visit(donor));
      const generation = dependencyGeneration + 1;
      const result = simulateCropCross(recipe.centre, recipe.donors);
      if (!result.certain || result.genome === null) {
        throw new Error("planned cross is no longer deterministic");
      }
      if (result.genome !== genome) throw new Error("planned cross does not reproduce its result genome");
      const key = crossKey(recipe.centre, recipe.donors);
      if (!stepByCross.has(key)) {
        stepByCross.set(key, {
          generation,
          centre: recipe.centre,
          donors: [...recipe.donors],
          result: genome,
        });
      }
      visiting.delete(genome);
      stepGeneration.set(genome, generation);
      return generation;
    };
    visit(root);
    const steps = [...stepByCross.values()].sort(
      (a, b) =>
        a.generation - b.generation ||
        a.centre.localeCompare(b.centre) ||
        a.donors.join("|").localeCompare(b.donors.join("|")),
    );
    const startingStrains = [...usedStarting]
      .filter((genome) => starting.has(genome))
      .sort()
      .map((genome) => ({ genome, poolIds: [...(starting.get(genome) ?? [])] }));
    return {
      steps,
      startingStrains,
      generations: steps.length === 0 ? 0 : steps[steps.length - 1].generation,
      crosses: steps.length,
    };
  };

  if (foundGenome !== null) {
    const tree = reconstruct(foundGenome);
    return {
      found: true,
      generations: tree.generations,
      crosses: tree.crosses,
      steps: tree.steps,
      startingStrains: tree.startingStrains,
      closest: null,
      limits,
    };
  }
  let closest: CropPathPlan["closest"] = null;
  if (best.current !== null) {
    const tree = reconstruct(best.current.genome);
    closest = {
      genome: best.current.genome,
      matchingSlots: best.current.matchingSlots,
      generations: tree.generations,
      steps: tree.steps,
      startingStrains: tree.startingStrains,
    };
  }
  return {
    found: false,
    generations: 0,
    crosses: 0,
    steps: [],
    startingStrains: [],
    closest,
    limits,
  };
}
