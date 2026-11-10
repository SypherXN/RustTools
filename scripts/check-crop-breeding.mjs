import assert from "node:assert/strict";
import * as shared from "../packages/shared/dist/index.js";

const { cropTargetStatus, findTwoDonorCrosses, simulateCropCross } = shared;
if (typeof shared.planCropPath !== "function") {
  console.error(
    "crop-breeding check: dist is missing planCropPath; run the shared build (npm run build --workspace=@rusttools/shared) and retry.",
  );
  process.exit(1);
}
const { planCropPath } = shared;

const same = (result, genome) => {
  assert.equal(result.genome, genome);
  assert.equal(result.certain, true);
  assert.equal(result.possibleOutcomes, 1);
};

// Centre is excluded from donor totals, so a donor G does not reinforce centre G.
same(simulateCropCross("GGGGGG", ["YYYYYY", "YYYYYY", "GGGGGG"]), "YYYYYY");
// Heavier donor genes replace the centre; lighter ones do not.
same(simulateCropCross("WWWWWW", ["GGGGGG", "GGGGGG"]), "GGGGGG");
same(simulateCropCross("GGGGGG", ["WWWWWW"]), "WWWWWW");
same(simulateCropCross("WWWWWW", ["GGGGGG"]), "WWWWWW");
same(simulateCropCross("GGGGGG", ["GGGGGG"]), "GGGGGG");
same(simulateCropCross("GYHWXG", []), "GYHWXG");
// 5 G donors (15) vs 3 W donors (15): tied, centre G is not biased.
const weightedTie = simulateCropCross("GGGGGG", [
  ...Array(5).fill("GGGGGG"),
  ...Array(3).fill("WWWWWW"),
]);
assert.equal(weightedTie.certain, false);
assert.deepEqual([...weightedTie.slots[0]].sort(), ["G", "W"]);
assert.equal(weightedTie.genome, null);
// XGGGGG centre, 2x G + 2x Y donors: slot 1 ties at 6 (above centre X weight 5).
const tie = simulateCropCross("XGGGGG", ["GGGGGG", "GGGGGG", "YGGGGG", "YGGGGG"]);
assert.deepEqual(tie.slots[0], ["G", "Y"]);
assert.equal(tie.certain, false);
assert.equal(tie.possibleOutcomes, 2);

// Positional target.
assert.deepEqual(cropTargetStatus(tie, "GGGGGG", false), { possible: true, guaranteed: false });
assert.deepEqual(cropTargetStatus(tie, "XYGGGG", false), { possible: false, guaranteed: false });
// anyOrder checks all possible outcomes by gene counts, not per-slot chance.
assert.deepEqual(cropTargetStatus(tie, "GGGGGG", true), { possible: true, guaranteed: false });
assert.deepEqual(cropTargetStatus(tie, "GGGGGY", true), { possible: true, guaranteed: false });
assert.deepEqual(cropTargetStatus(tie, "GGGGYY", true), { possible: false, guaranteed: false });
assert.deepEqual(cropTargetStatus(tie, "HHHHHH", true), { possible: false, guaranteed: false });
const certain = simulateCropCross("GGGGGG", ["GGGGGG"]);
assert.deepEqual(cropTargetStatus(certain, "GGGGGG", true), { possible: true, guaranteed: true });
assert.deepEqual(cropTargetStatus(certain, "GGGGGY", true), { possible: false, guaranteed: false });

// Validation.
assert.throws(() => simulateCropCross("GGGGG", []), /exactly 6 genes/);
assert.throws(() => simulateCropCross("GGGGGG", ["ZZZZZZ"]), /exactly 6 genes/);
assert.throws(() => simulateCropCross("GGGGGG", Array(9).fill("GGGGGG")), /at most 8/);
assert.throws(() => simulateCropCross("GGGGGG", "GGGGGG"), /array/);
assert.throws(() => cropTargetStatus(tie, "GGGGG", false), /exactly 6 genes/);
assert.equal(simulateCropCross(" gggggg ", ["wwwwww"]).genome, "WWWWWW");

// Search: quantity 2 lets one donor entry fill both donor slots.
const twoCopies = findTwoDonorCrosses(
  [
    { id: "c", genes: "GGGGGG", quantity: 1 },
    { id: "y", genes: "YYYYYY", quantity: 2 },
  ],
  "YYYYYY",
  false,
);
assert.deepEqual(twoCopies.plans[0]?.donorIds, ["y", "y"]);
assert.equal(twoCopies.plans[0]?.guaranteed, true);
assert.equal(twoCopies.truncated, false);

// quantity 0 is excluded, duplicates cannot all be used, quantities respected.
const noCopies = findTwoDonorCrosses(
  [
    { id: "c", genes: "GGGGGG", quantity: 1 },
    { id: "y", genes: "YYYYYY", quantity: 1 },
  ],
  "YYYYYY",
  false,
);
assert.equal(noCopies.evaluated, 0);
assert.equal(noCopies.plans.length, 0);
assert.equal(findTwoDonorCrosses([], "GGGGGG", false).plans.length, 0);
assert.throws(
  () => findTwoDonorCrosses([{ id: "c", genes: "GGGGGG", quantity: 0.5 }], "GGGGGG", false),
  /non-negative integer/,
);
assert.throws(
  () =>
    findTwoDonorCrosses(
      [
        { id: "c", genes: "GGGGGG", quantity: 1 },
        { id: "c", genes: "GGGGGG", quantity: 1 },
      ],
      "GGGGGG",
      false,
    ),
  /duplicate pool id/,
);

// More than 50 usable entries truncates; plans stay capped at 10 with guaranteed first.
const big = Array.from({ length: 51 }, (_, i) => ({
  id: `p${i}`,
  genes: i % 2 ? "YYYYYY" : "GGGGGG",
  quantity: 2,
}));
const capped = findTwoDonorCrosses(big, "YYYYYY", true);
assert.equal(capped.truncated, true);
assert.ok(capped.plans.length <= 10);
const firstUnguaranteed = capped.plans.findIndex((plan) => !plan.guaranteed);
assert.ok(firstUnguaranteed === -1 || capped.plans.slice(firstUnguaranteed).every((p) => !p.guaranteed));
assert.deepEqual(
  findTwoDonorCrosses(big, "YYYYYY", true).plans.map((p) => p.centreId),
  capped.plans.map((p) => p.centreId),
);
// ---- multi-generation path planner ----

function replayPath(pool, plan) {
  const byId = new Map(pool.map((entry) => [entry.id, entry.genes]));
  const available = new Map();
  for (const strain of plan.startingStrains) {
    assert.ok(strain.poolIds.length > 0, `starting strain ${strain.genome} has no pool ids`);
    for (const id of strain.poolIds) {
      assert.equal(byId.get(id), strain.genome, `starting pool id ${id} does not match ${strain.genome}`);
    }
    available.set(strain.genome, 0);
  }
  for (const step of [...plan.steps].sort((a, b) => a.generation - b.generation)) {
    for (const genome of [step.centre, ...step.donors]) {
      assert.ok(available.has(genome), `step uses unplanned genome ${genome}`);
      assert.ok(available.get(genome) < step.generation, `step uses ${genome} in the same generation`);
    }
    const result = simulateCropCross(step.centre, step.donors);
    assert.equal(result.certain, true, "planned step must be deterministic");
    assert.equal(result.genome, step.result, "planned step result mismatch");
    available.set(step.result, step.generation);
  }
  return available;
}

const pathPool = [
  { id: "a", genes: "GGGGGG", quantity: 1 },
  { id: "d", genes: "WWGGGG", quantity: 1 },
  { id: "e", genes: "GGWWGG", quantity: 1 },
];

// Target already held.
const held = planCropPath([...pathPool, { id: "t", genes: "YYYYYY", quantity: 1 }], "yyyyyy", false);
assert.equal(held.found, true);
assert.equal(held.generations, 0);
assert.deepEqual(held.steps, []);
assert.deepEqual(held.startingStrains, [{ genome: "YYYYYY", poolIds: ["t"] }]);

// Hand-derived one-generation plan: E=GGWWGG centre + D=WWGGGG donor gives
// slot0/1 W from D, slot2/3 W retained, slot4/5 G retained => WWWWGG.
const one = planCropPath(pathPool, "WWWWGG", false);
assert.equal(one.found, true);
assert.equal(one.generations, 1);
assert.equal(one.crosses, 1);
assert.equal(one.closest, null);
assert.equal(one.limits.truncated, false);
assert.equal(one.steps.length, 1);
assert.equal(one.steps[0].generation, 1);
assert.equal(one.steps[0].result, "WWWWGG");
assert.equal(simulateCropCross(one.steps[0].centre, one.steps[0].donors).genome, "WWWWGG");
replayPath(pathPool, one);

// Hand-derived two-generation plan: six one-W strains, target WWWWGG, max 3 donors.
// Generation 1 can reach at most two W slots (two donor W positions via a
// two-donor cross); three donors with only one W at a slot are demoted because
// G3+G3=6 beats that W. Generation 2 then combines disjoint 2-W genomes.
const singles = Array.from({ length: 6 }, (_, index) => ({
  id: `p${index}`,
  genes: `${"G".repeat(index)}W${"G".repeat(5 - index)}`,
  quantity: 1,
}));

function firstGenerationMaxW() {
  let maxW = 0;
  for (const centre of singles) {
    const donors = [];
    const walk = (start) => {
      if (donors.length > 0) {
        const result = simulateCropCross(centre.genes, donors.map((donor) => donor.genes));
        if (result.certain && result.genome) {
          maxW = Math.max(maxW, [...result.genome].filter((gene) => gene === "W").length);
        }
      }
      if (donors.length === 3) return;
      for (let index = start; index < singles.length; index++) {
        donors.push(singles[index]);
        walk(index);
        donors.pop();
      }
    };
    walk(0);
  }
  return maxW;
}
assert.equal(firstGenerationMaxW(), 2);

const two = planCropPath(singles, "WWWWGG", false, { maxDonors: 3 });
assert.equal(two.found, true);
assert.equal(two.generations, 2);
assert.equal(two.crosses, 3);
assert.equal(two.limits.maxDonors, 3);
assert.equal(two.limits.truncated, false);
assert.ok(two.steps.every((step) => step.generation <= 2));
assert.equal(two.steps.filter((step) => step.result === "WWWWGG").length, 1);
replayPath(singles, two);

// The original six-singles -> WWWWWW target needs a third generation with
// maxDonors 3; it is not a two-generation path.
const sixW = planCropPath(singles, "WWWWWW", false, { maxDonors: 3 });
assert.equal(sixW.found, true);
assert.equal(sixW.generations, 3);

// anyOrder matches gene counts, not the exact arrangement.
const anyOrder = planCropPath(pathPool, "GWWWGW", true);
assert.equal(anyOrder.found, true);
assert.equal(anyOrder.generations, 1);
replayPath(pathPool, anyOrder);
assert.equal(
  [...anyOrder.steps[anyOrder.steps.length - 1].result].sort().join(""),
  [..."GWWWGW"].sort().join(""),
);
assert.equal(planCropPath(pathPool, "GWWWGW", false).found, false);

// Two generations at maxDonors 1 can reach four W slots but not six.
const twoGenCap = planCropPath(singles, "WWWWWW", false, { maxGenerations: 2, maxDonors: 1 });
assert.equal(twoGenCap.found, false);
assert.ok(twoGenCap.closest);
assert.equal(twoGenCap.closest.matchingSlots, 4);
assert.equal(twoGenCap.closest.generations, 2);
assert.ok(twoGenCap.closest.steps.length > 0);
replayPath(singles, twoGenCap.closest);

// maxGenerations clamps to 1..8.
const zeroGenerations = planCropPath(singles, "WWWWWW", false, { maxGenerations: 0, maxDonors: 1 });
assert.equal(zeroGenerations.limits.maxGenerations, 1);
assert.equal(zeroGenerations.found, false);
assert.equal(zeroGenerations.closest.matchingSlots, 2);
const threeGenerations = planCropPath(singles, "WWWWWW", false, { maxGenerations: 3, maxDonors: 1 });
assert.equal(threeGenerations.found, true);
assert.equal(threeGenerations.generations, 3);
replayPath(singles, threeGenerations);
const highGenerations = planCropPath(singles, "WWWWWW", false, { maxGenerations: 99, maxDonors: 1 });
assert.equal(highGenerations.limits.maxGenerations, 8);
assert.equal(highGenerations.found, true);

// maxDonors clamps; one donor already reaches WWWWGG from this pool.
const noDonors = planCropPath(pathPool, "WWWWGG", false, { maxDonors: 0 });
assert.equal(noDonors.limits.maxDonors, 1);
assert.equal(noDonors.found, true);
replayPath(pathPool, noDonors);

// Ties are never planned: XXGGGG would need the W/X tie at slots 0 and 1
// resolved, so the planner must not reach it through an uncertain cross.
const tiePool = [
  { id: "a", genes: "GGGGGG", quantity: 1 },
  { id: "xw", genes: "XWGGGG", quantity: 1 },
  { id: "wx", genes: "WXGGGG", quantity: 1 },
];
const ties = planCropPath(tiePool, "XXGGGG", false);
assert.equal(ties.found, false);
assert.ok(ties.closest);
assert.equal(ties.closest.matchingSlots, 5);
replayPath(tiePool, ties.closest);

// Empty pool: no invented plan or closest genome.
const empty = planCropPath([], "GGGGGG", false);
assert.equal(empty.found, false);
assert.equal(empty.closest, null);
assert.deepEqual(empty.steps, []);

// More than 50 usable pool entries truncates the starting pool.
const many = Array.from({ length: 51 }, (_, index) => ({
  id: `q${index}`,
  genes: index % 2 ? "YYYYYY" : "GGGGGG",
  quantity: 1,
}));
const truncated = planCropPath(many, "YYYYYY", false);
assert.equal(truncated.found, true);
assert.equal(truncated.generations, 0);
assert.equal(truncated.limits.truncated, true);

// Validation matches the single-generation search style.
assert.throws(() => planCropPath([], "GGGGG", false), /exactly 6 genes/);
assert.throws(() => planCropPath("nope", "GGGGGG", false), /pool must be an array/);
assert.throws(
  () =>
    planCropPath(
      [
        { id: "a", genes: "GGGGGG", quantity: 1 },
        { id: "a", genes: "GGGGGG", quantity: 1 },
      ],
      "GGGGGG",
      false,
    ),
  /duplicate pool id/,
);
assert.throws(() => planCropPath([{ id: "a", genes: "GGGGGG", quantity: -1 }], "GGGGGG", false), /non-negative integer/);
assert.throws(() => planCropPath([{ id: "a", genes: "ZZZZZZ", quantity: 1 }], "GGGGGG", false), /exactly 6 genes/);
assert.throws(() => planCropPath([], "GGGGGG", false, { maxGenerations: NaN }), /finite number/);
assert.throws(() => planCropPath([], "GGGGGG", false, null), /options must be an object/);

console.log("crop-breeding checks passed");
