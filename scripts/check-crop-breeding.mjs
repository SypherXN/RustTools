import assert from "node:assert/strict";
import {
  cropTargetStatus,
  findTwoDonorCrosses,
  simulateCropCross,
} from "../packages/shared/dist/index.js";

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
console.log("crop-breeding checks passed");
