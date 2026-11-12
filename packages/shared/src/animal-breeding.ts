// model: rustlite-v1 — fixed inheritance/expression rules; only params are fitted.
export const ANIMAL_MODEL_VERSION = "rustlite-v1";
export const ANIMAL_TRAITS = Object.freeze(["dung", "yield", "fertility", "hardiness"] as const);
/** Order is the ordinal grade: bad = 0, okay = 1, good = 2. */
export const ANIMAL_GRADES = Object.freeze(["bad", "okay", "good"] as const);
export type AnimalTrait = (typeof ANIMAL_TRAITS)[number];
export type AnimalGrade = (typeof ANIMAL_GRADES)[number];
export interface AnimalAllelePair { a: AnimalGrade; b: AnimalGrade }
type LineagePair = { a: string | null; b: string | null };
export type AnimalGenotype = Record<AnimalTrait, AnimalAllelePair | null> & {
  /** Independent markers; null/omitted means unobserved, never an invented ID. */
  lineage?: LineagePair | null;
};
export interface AnimalModelParams {
  version: typeof ANIMAL_MODEL_VERSION;
  priors: Record<AnimalGrade, number>;
  mutationChance: number;
  /** Production/effect penalty when lineage markers match: a numerical effect outside
   * this genotype API. The multiplier (0.5 vs disputed 0.7) is unresolved, so it is
   * carried and described, never applied to grade inheritance. */
  inbredScale: number;
}
export interface AnimalBirth {
  mother: AnimalGenotype | null;
  father: AnimalGenotype | null;
  offspring: AnimalGenotype | null;
}
export interface AnimalCrossOutcome { genotype: AnimalGenotype; probability: number }

function modelParams(params?: AnimalModelParams): AnimalModelParams {
  const value = params ?? {
    version: ANIMAL_MODEL_VERSION,
    priors: { good: 0.2, okay: 0.5, bad: 0.3 },
    mutationChance: 0,
    inbredScale: 0.5,
  };
  if (value.version !== ANIMAL_MODEL_VERSION) throw new Error("Unsupported animal model version");
  for (const grade of ANIMAL_GRADES) {
    const p = value.priors?.[grade];
    if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error("Invalid animal priors");
  }
  const sum = ANIMAL_GRADES.reduce((n, grade) => n + value.priors[grade], 0);
  if (Math.abs(sum - 1) > 1e-9) throw new Error("Animal priors must sum to 1");
  if (!Number.isFinite(value.mutationChance) || value.mutationChance < 0 || value.mutationChance > 1) {
    throw new Error("mutationChance must be between 0 and 1");
  }
  if (!Number.isFinite(value.inbredScale) || value.inbredScale < 0) {
    throw new Error("inbredScale must be finite and non-negative");
  }
  return { ...value, priors: { ...value.priors } };
}

function checkPair(pair: AnimalAllelePair | null): void {
  if (pair !== null && (!pair || !ANIMAL_GRADES.includes(pair.a) || !ANIMAL_GRADES.includes(pair.b))) {
    throw new Error("Animal alleles must be bad, okay or good (or a null pair)");
  }
}

function checkGenotype(genotype: AnimalGenotype | null): void {
  if (genotype === null) return;
  for (const trait of ANIMAL_TRAITS) checkPair(genotype[trait]);
  if (genotype.lineage != null) {
    for (const marker of [genotype.lineage.a, genotype.lineage.b]) {
      if (marker !== null && (typeof marker !== "string" || marker.trim() === "")) {
        throw new Error("Lineage markers must be non-empty strings or null");
      }
    }
  }
}

export function expressedGrade(pair: AnimalAllelePair | null): AnimalGrade | null {
  checkPair(pair);
  if (pair === null) return null;
  return ANIMAL_GRADES[Math.max(ANIMAL_GRADES.indexOf(pair.a), ANIMAL_GRADES.indexOf(pair.b))];
}

function alleleOdds(pair: AnimalAllelePair | null, params: AnimalModelParams): Record<AnimalGrade, number> {
  const odds = { bad: 0, okay: 0, good: 0 };
  if (pair === null) Object.assign(odds, params.priors);
  else { odds[pair.a] += 0.5; odds[pair.b] += 0.5; }
  // model: rustlite-v1 — independent per-allele uniform reroll, including the same grade.
  for (const grade of ANIMAL_GRADES) {
    odds[grade] = odds[grade] * (1 - params.mutationChance) + params.mutationChance / 3;
  }
  return odds;
}

function traitCross(mother: AnimalAllelePair | null, father: AnimalAllelePair | null, params: AnimalModelParams) {
  const maternal = alleleOdds(mother, params);
  const paternal = alleleOdds(father, params);
  const outcomes: { pair: AnimalAllelePair; probability: number }[] = [];
  for (const a of ANIMAL_GRADES) {
    for (const b of ANIMAL_GRADES) {
      const probability = maternal[a] * paternal[b];
      if (probability > 0) outcomes.push({ pair: { a, b }, probability });
    }
  }
  return outcomes;
}

export function crossAnimalGenotypes(
  mother: AnimalGenotype | null,
  father: AnimalGenotype | null,
  params?: AnimalModelParams,
): AnimalCrossOutcome[] {
  const model = modelParams(params);
  checkGenotype(mother);
  checkGenotype(father);
  let outcomes: AnimalCrossOutcome[] = [{
    genotype: { dung: null, yield: null, fertility: null, hardiness: null }, probability: 1,
  }];
  for (const trait of ANIMAL_TRAITS) {
    const options = traitCross(mother?.[trait] ?? null, father?.[trait] ?? null, model);
    outcomes = outcomes.flatMap((outcome) => options.map(({ pair, probability }) => ({
      genotype: { ...outcome.genotype, [trait]: { ...pair } },
      probability: outcome.probability * probability,
    })));
  }
  // model: rustlite-v1 — lineage segregates independently of all four traits.
  if (mother?.lineage != null || father?.lineage != null) {
    const maternal = mother?.lineage ?? { a: null, b: null };
    const paternal = father?.lineage ?? { a: null, b: null };
    const markers: { lineage: LineagePair; probability: number }[] = [];
    for (const a of new Set([maternal.a, maternal.b])) {
      for (const b of new Set([paternal.a, paternal.b])) {
        markers.push({
          lineage: { a, b },
          probability: (maternal.a === maternal.b ? 1 : 0.5) * (paternal.a === paternal.b ? 1 : 0.5),
        });
      }
    }
    outcomes = outcomes.flatMap((outcome) => markers.map(({ lineage, probability }) => ({
      genotype: { ...outcome.genotype, lineage: { ...lineage } },
      probability: outcome.probability * probability,
    })));
  }
  return outcomes;
}

export function offspringTraitOdds(
  mother: AnimalGenotype | null,
  father: AnimalGenotype | null,
  trait: AnimalTrait,
  params?: AnimalModelParams,
): Record<AnimalGrade, number> {
  const model = modelParams(params);
  checkGenotype(mother);
  checkGenotype(father);
  if (!ANIMAL_TRAITS.includes(trait)) throw new Error("Invalid animal trait");
  const odds = { bad: 0, okay: 0, good: 0 };
  for (const { pair, probability } of traitCross(mother?.[trait] ?? null, father?.[trait] ?? null, model)) {
    odds[expressedGrade(pair)!] += probability;
  }
  return odds;
}

export function carrierProbability(
  pair: AnimalAllelePair | null,
  expressed: AnimalGrade,
  params?: AnimalModelParams,
): number {
  const model = modelParams(params);
  checkPair(pair);
  if (!ANIMAL_GRADES.includes(expressed)) throw new Error("Invalid expressed grade");
  if (pair !== null) return expressedGrade(pair) === expressed && pair.a !== pair.b ? 1 : 0;
  const p = model.priors[expressed];
  const lower = ANIMAL_GRADES.slice(0, ANIMAL_GRADES.indexOf(expressed))
    .reduce((sum, grade) => sum + model.priors[grade], 0);
  const heterozygous = 2 * p * lower;
  const possible = p * p + heterozygous;
  // An expression with zero prior support has no supported carrier probability.
  return possible === 0 ? 0 : heterozygous / possible;
}

export function fitAnimalModel(births: AnimalBirth[], base?: AnimalModelParams): {
  params: AnimalModelParams;
  evidence: {
    priors: { sampleSize: number; applied: boolean };
    mutationChance: { sampleSize: number; applied: boolean };
    inbredScale: { sampleSize: number; applied: boolean };
    violations: number;
  };
} {
  const params = modelParams(base);
  if (!Array.isArray(births)) throw new Error("births must be an array");
  const counts = { bad: 0, okay: 0, good: 0 };
  let observed = 0;
  let comparable = 0;
  let unexpected = 0;
  let violations = 0;
  for (const birth of births) {
    for (const genotype of [birth.mother, birth.father, birth.offspring]) {
      checkGenotype(genotype);
      for (const trait of ANIMAL_TRAITS) {
        const pair = genotype?.[trait];
        if (pair) { counts[pair.a]++; counts[pair.b]++; observed += 2; }
      }
    }
    let impossible = false;
    for (const trait of ANIMAL_TRAITS) {
      const child = birth.offspring?.[trait];
      if (!child) continue;
      const mother = birth.mother?.[trait];
      const father = birth.father?.[trait];
      const has = (pair: AnimalAllelePair | null | undefined, grade: AnimalGrade) =>
        pair == null || pair.a === grade || pair.b === grade;
      // Unphased observed copies: either assignment must allow one from each parent.
      if (!(has(mother, child.a) && has(father, child.b)) &&
          !(has(mother, child.b) && has(father, child.a))) impossible = true;
      if (mother && father) {
        comparable += 2;
        for (const grade of [child.a, child.b]) {
          if (!has(mother, grade) && !has(father, grade)) unexpected++;
        }
      }
    }
    if (impossible) violations++;
  }
  // model: rustlite-v1 — alpha=1 per grade (Dirichlet smoothing); gates are fixed.
  if (observed >= 40) {
    for (const grade of ANIMAL_GRADES) params.priors[grade] = (counts[grade] + 1) / (observed + 3);
  }
  // This is the requested novel-allele rate, not a correction for invisible rerolls.
  if (comparable >= 200) params.mutationChance = unexpected / comparable;
  return {
    params,
    evidence: {
      priors: { sampleSize: observed, applied: observed >= 40 },
      mutationChance: { sampleSize: comparable, applied: comparable >= 200 },
      inbredScale: { sampleSize: 0, applied: false },
      // Raw Mendelian conflicts, including candidate mutations; count births, not traits.
      violations,
    },
  };
}

export function describeAnimalModel(params: AnimalModelParams): string[] {
  const model = modelParams(params);
  const percent = (p: number) => `${Number((p * 100).toFixed(2))}%`;
  return [
    `Inheritance: one allele per parent, better copy expresses (${ANIMAL_MODEL_VERSION})`,
    `Wild priors: ${percent(model.priors.good)} good / ${percent(model.priors.okay)} okay / ${percent(model.priors.bad)} bad`,
    `Mutation: ${percent(model.mutationChance)}`,
    `Inbreeding reduces production effects when lineage markers match (multiplier ${model.inbredScale}, disputed; grades are unaffected)`,
    "Lineage: one independent marker per parent; matching markers affect effects, not allele inheritance",
  ];
}
