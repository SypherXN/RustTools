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
