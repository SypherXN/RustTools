import {
  ANIMAL_GRADES,
  ANIMAL_TRAITS,
  type AnimalAllelePair,
  type AnimalGenotype,
  type AnimalTrait,
} from "@rusttools/shared";

export type AnimalGenotypeJson = {
  traits: Partial<Record<AnimalTrait, AnimalAllelePair | null>>;
  markers?: [string, string];
};

type Decoded = {
  genotype: AnimalGenotypeJson | null;
  json: string | null;
  model: AnimalGenotype | null;
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The same strict codec handles request objects and persisted JSON. */
export function parseAnimalGenotype(
  value: unknown,
  source: "input" | "storage",
): { ok: true; value: Decoded } | { ok: false; error: string } {
  const invalid = () => ({ ok: false as const, error: "Invalid animalGenotype" });
  if (source === "storage") {
    if (value === null) return { ok: true, value: { genotype: null, json: null, model: null } };
    if (typeof value !== "string") return invalid();
    try { value = JSON.parse(value); } catch { return invalid(); }
  }
  if (!object(value) || Object.keys(value).some((key) => key !== "traits" && key !== "markers")) {
    return invalid();
  }
  if (!object(value.traits) || Object.keys(value.traits).some(
    (key) => !ANIMAL_TRAITS.some((trait) => trait === key),
  )) return invalid();

  const genotype: AnimalGenotypeJson = { traits: {} };
  const model: AnimalGenotype = {
    dung: null, yield: null, fertility: null, hardiness: null, lineage: null,
  };
  for (const trait of ANIMAL_TRAITS) {
    if (!Object.hasOwn(value.traits, trait)) continue;
    const pair = value.traits[trait];
    if (pair === null) { genotype.traits[trait] = null; continue; }
    if (!object(pair) || Object.keys(pair).some((key) => key !== "a" && key !== "b")) return invalid();
    const a = ANIMAL_GRADES.find((grade) => grade === pair.a);
    const b = ANIMAL_GRADES.find((grade) => grade === pair.b);
    if (!a || !b) return invalid();
    genotype.traits[trait] = { a, b };
    model[trait] = { a, b };
  }
  if (Object.hasOwn(value, "markers")) {
    const markers = value.markers;
    if (!Array.isArray(markers) || markers.length !== 2 || markers.some(
      (marker) => typeof marker !== "string" || !marker.trim() || marker.length > 8,
    )) return invalid();
    genotype.markers = [markers[0], markers[1]];
    model.lineage = { a: markers[0], b: markers[1] };
  }
  return { ok: true, value: { genotype, json: JSON.stringify(genotype), model } };
}
