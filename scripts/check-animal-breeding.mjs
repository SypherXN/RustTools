import assert from "node:assert/strict";
import {
  ANIMAL_GRADES, ANIMAL_MODEL_VERSION, ANIMAL_TRAITS,
  carrierProbability, crossAnimalGenotypes, describeAnimalModel,
  expressedGrade, fitAnimalModel, offspringTraitOdds,
} from "../packages/shared/dist/index.js";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const pair = (a, b = a) => ({ a, b });
const genotype = (a, b = a) => Object.fromEntries(ANIMAL_TRAITS.map((trait) => [trait, pair(a, b)]));
const defaults = fitAnimalModel([]).params;
assert.equal(ANIMAL_MODEL_VERSION, "rustlite-v1");
assert.deepEqual(ANIMAL_GRADES, ["bad", "okay", "good"]);
assert.deepEqual(ANIMAL_TRAITS, ["dung", "yield", "fertility", "hardiness"]);
assert.ok(Object.isFrozen(ANIMAL_TRAITS) && Object.isFrozen(ANIMAL_GRADES));
assert.deepEqual(defaults, {
  version: "rustlite-v1", priors: { good: 0.2, okay: 0.5, bad: 0.3 },
  mutationChance: 0, inbredScale: 0.5,
});
assert.equal(expressedGrade(pair("bad", "good")), "good");
assert.equal(expressedGrade(pair("okay", "bad")), "okay");
assert.equal(expressedGrade(pair("bad")), "bad");
assert.equal(expressedGrade(null), null);

const bad = genotype("bad");
const good = genotype("good");
const heterozygous = genotype("bad", "good");
// Bad x expressed-Good is 50/50 only when that Good parent carries Bad.
assert.deepEqual(offspringTraitOdds(bad, heterozygous, "dung"), { bad: 0.5, okay: 0, good: 0.5 });
assert.deepEqual(offspringTraitOdds(bad, good, "dung"), { bad: 0, okay: 0, good: 1 });
for (const [mother, father] of [[bad, heterozygous], [null, null], [heterozygous, heterozygous]]) {
  const outcomes = crossAnimalGenotypes(mother, father);
  close(outcomes.reduce((sum, outcome) => sum + outcome.probability, 0), 1);
  assert.ok(outcomes.every(({ probability }) => probability > 0));
  const odds = offspringTraitOdds(mother, father, "yield");
  for (const grade of ANIMAL_GRADES) {
    close(outcomes.filter(({ genotype: g }) => expressedGrade(g.yield) === grade)
      .reduce((sum, o) => sum + o.probability, 0), odds[grade]);
  }
}
const unknown = offspringTraitOdds(null, bad, "dung");
for (const grade of ANIMAL_GRADES) close(unknown[grade], defaults.priors[grade]);
const bothUnknown = offspringTraitOdds(null, null, "dung");
close(bothUnknown.bad, 0.09);
close(bothUnknown.okay, 0.55);
close(bothUnknown.good, 0.36);
const custom = { ...defaults, priors: { bad: 1, okay: 0, good: 0 } };
assert.deepEqual(offspringTraitOdds(null, null, "dung", custom), { bad: 1, okay: 0, good: 0 });
assert.deepEqual(crossAnimalGenotypes(bad, bad), [{ genotype: bad, probability: 1 }]);
const mutated = { ...defaults, mutationChance: 1 };
const mutationOdds = offspringTraitOdds(bad, bad, "dung", mutated);
close(mutationOdds.good, 5 / 9);
close(mutationOdds.okay, 1 / 3);
close(mutationOdds.bad, 1 / 9);
const mutationOutcomes = crossAnimalGenotypes(bad, bad, mutated);
close(mutationOutcomes.reduce((sum, o) => sum + o.probability, 0), 1);
assert.ok(mutationOutcomes.some(({ genotype: g }) => g.dung.a === "good"));
assert.equal(carrierProbability(pair("good", "bad"), "good"), 1);
assert.equal(carrierProbability(pair("good"), "good"), 0);
assert.equal(carrierProbability(pair("bad"), "good"), 0);
const carrier = carrierProbability(null, "good");
assert.ok(carrier > 0 && carrier < 1);
close(carrier, 8 / 9);
assert.equal(carrierProbability(null, "bad"), 0);
assert.equal(carrierProbability(null, "good", custom), 0);

const observed = { mother: null, father: null, offspring: good };
const smallFit = fitAnimalModel(Array(4).fill(observed));
assert.deepEqual(smallFit.params.priors, defaults.priors);
assert.deepEqual(smallFit.evidence.priors, { sampleSize: 32, applied: false });
const priorFit = fitAnimalModel(Array(5).fill(observed));
assert.deepEqual(priorFit.evidence.priors, { sampleSize: 40, applied: true });
close(priorFit.params.priors.good, 41 / 43);
close(priorFit.params.priors.okay, 1 / 43);
close(priorFit.params.priors.bad, 1 / 43);
assert.equal(priorFit.evidence.mutationChance.sampleSize, 0);
assert.equal(priorFit.evidence.violations, 0);

const novelBirth = { mother: bad, father: bad, offspring: heterozygous };
const base = { ...defaults, mutationChance: 0.1, inbredScale: 0.7 };
const snapshot = JSON.stringify(base);
const belowMutationGate = fitAnimalModel(Array(24).fill(novelBirth), base);
assert.equal(belowMutationGate.params.mutationChance, 0.1);
assert.deepEqual(belowMutationGate.evidence.mutationChance, { sampleSize: 192, applied: false });
const mutationFit = fitAnimalModel(Array(25).fill(novelBirth), base);
assert.equal(mutationFit.params.mutationChance, 0.5);
assert.deepEqual(mutationFit.evidence.mutationChance, { sampleSize: 200, applied: true });
assert.equal(mutationFit.params.inbredScale, 0.7);
assert.deepEqual(mutationFit.evidence.inbredScale, { sampleSize: 0, applied: false });
assert.equal(mutationFit.params.version, ANIMAL_MODEL_VERSION);
assert.equal(mutationFit.evidence.violations, 25);
assert.equal(JSON.stringify(base), snapshot);
assert.deepEqual(fitAnimalModel([]).params, defaults);

// These alleles are in the parental union, but both cannot come from one parent.
assert.equal(fitAnimalModel([{ mother: bad, father: good, offspring: bad }]).evidence.violations, 1);
// Observation is unphased: either assignment to parents is allowed.
assert.equal(fitAnimalModel([{ mother: bad, father: good, offspring: genotype("good", "bad") }])
  .evidence.violations, 0);
assert.equal(fitAnimalModel([{ mother: bad, father: null, offspring: good }]).evidence.violations, 1);

const markedMother = { ...bad, lineage: { a: "m1", b: "m2" } };
const markedFather = { ...good, lineage: { a: "f1", b: "f2" } };
const markers = crossAnimalGenotypes(markedMother, markedFather);
assert.equal(markers.length, 4);
for (const outcome of markers) {
  close(outcome.probability, 0.25);
  assert.ok(["m1", "m2"].includes(outcome.genotype.lineage.a));
  assert.ok(["f1", "f2"].includes(outcome.genotype.lineage.b));
  assert.equal(expressedGrade(outcome.genotype.dung), "good");
}
assert.equal(new Set(markers.map((o) => JSON.stringify(o.genotype.lineage))).size, 4);
const homoMarkers = { ...bad, lineage: { a: "shared", b: "shared" } };
assert.deepEqual(crossAnimalGenotypes(homoMarkers, homoMarkers, base),
  crossAnimalGenotypes(homoMarkers, homoMarkers, { ...base, inbredScale: 0.5 }));
const oneKnown = crossAnimalGenotypes(homoMarkers, bad);
assert.equal(oneKnown.length, 1);
assert.deepEqual(oneKnown[0].genotype.lineage, { a: "shared", b: null });

assert.ok(describeAnimalModel(defaults).some((line) => line.includes(ANIMAL_MODEL_VERSION)));
assert.ok(describeAnimalModel(defaults).includes("Wild priors: 20% good / 50% okay / 30% bad"));
assert.ok(describeAnimalModel(defaults).includes("Mutation: 0%"));
assert.ok(describeAnimalModel(defaults).includes(
  "Inbreeding reduces production effects when lineage markers match (multiplier 0.5, disputed; grades are unaffected)",
));
assert.ok(describeAnimalModel(base).includes(
  "Inbreeding reduces production effects when lineage markers match (multiplier 0.7, disputed; grades are unaffected)",
));
assert.throws(() => fitAnimalModel([], { ...defaults, version: "other" }), /version/);
assert.throws(() => offspringTraitOdds(null, null, "dung", { ...defaults, mutationChance: 2 }), /mutationChance/);
assert.throws(() => crossAnimalGenotypes(null, null, { ...defaults, priors: { bad: 1, okay: 1, good: 1 } }), /sum/);
assert.throws(() => expressedGrade(pair("invalid")), /alleles/);
console.log("animal breeding checks passed");
