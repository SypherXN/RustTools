/**
 * Runnable lineage-helper self-check. Type-only imports are erased at runtime,
 * so this runs before the workspace deps are installed:
 *   node --experimental-strip-types apps/web/src/lib/breeding-utils.selfcheck.ts
 * (Optional unless lineage helpers change.)
 */
import type { BreedingEntry } from "@rusttools/shared";
import {
  breedingPairWarning,
  breedingWouldCycle,
  breedingAncestorIds,
  formatBreedingUpdated,
  isBreedingAvailable,
} from "./breeding-utils.ts";

const demo = (over: Partial<BreedingEntry>): BreedingEntry => ({
  id: "",
  kind: "animal",
  name: "",
  species: "cow",
  serverLabel: "US West — wipe 4d",
  genes: "",
  traits: "",
  quantity: 1,
  location: "base",
  available: true,
  sex: "female",
  potential: "",
  motherId: null,
  fatherId: null,
  notes: "",
  createdBy: "DemoAdmin",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  ...over,
});

const entries: BreedingEntry[] = [
  demo({ id: "gran", name: "Grandma", sex: "female" }),
  demo({ id: "mom", name: "Mom", motherId: "gran" }),
  demo({ id: "aunt", name: "Aunt", motherId: "gran" }),
  demo({ id: "kid", name: "Kid", motherId: "mom" }),
  demo({ id: "heifer", name: "Heifer", species: "sheep" }),
];

const fails: string[] = [];
const assert = (condition: boolean, message: string) => {
  if (!condition) {
    fails.push(message);
    console.error("FAIL:", message);
  } else {
    console.log("ok:", message);
  }
};

assert(breedingAncestorIds(entries, "kid").has("gran"), "grandmother found transitively");
assert(breedingPairWarning(entries, "kid", "aunt") !== null, "nieces/uncles flagged as related pair");
assert(breedingPairWarning(entries, "mom", "kid") !== null, "direct parent flagged");
assert(breedingPairWarning(entries, "kid", "heifer") === null, "unrelated pair returns null");
assert(breedingWouldCycle(entries, "mom", "kid"), "choosing own offspring as parent cycles");
assert(!breedingWouldCycle(entries, "kid", "mom"), "choosing mother is not a cycle");
assert(!isBreedingAvailable(demo({ available: true, quantity: 0 })), "quantity 0 = not available");
assert(!isBreedingAvailable(demo({ available: false, quantity: 4 })), "flag off = not available");
assert(formatBreedingUpdated("2026-01-02T00:00:00.000Z").length > 5, "formatBreedingUpdated works");

console.log("breeding-utils checks done");
if (fails.length > 0) throw new Error(`${fails.length} breeding-utils check(s) failed`);
