import type { breedingEntries } from "@rusttools/db";
import {
  ANIMAL_GRADES,
  ANIMAL_MODEL_VERSION,
  ANIMAL_TRAITS,
  describeAnimalModel,
  fitAnimalModel,
  offspringTraitOdds,
  type AnimalBirth,
} from "@rusttools/shared";
import { parseAnimalGenotype } from "./animal-genotype.js";

type AnimalRow = Pick<typeof breedingEntries.$inferSelect,
  "id" | "motherId" | "fatherId" | "animalGenotypeJson">;

export function analyzeAnimals(rows: AnimalRow[]) {
  const animals = rows.map((row) => {
    const decoded = parseAnimalGenotype(row.animalGenotypeJson, "storage");
    return { ...row, genotype: decoded.ok ? decoded.value.model : null, invalid: !decoded.ok };
  });
  const byId = new Map(animals.map((animal) => [animal.id, animal]));
  let withBothParents = 0;
  const births: AnimalBirth[] = animals.map((animal) => {
    const mother = animal.motherId ? byId.get(animal.motherId) : null;
    const father = animal.fatherId ? byId.get(animal.fatherId) : null;
    if (mother && father) withBothParents++;
    return {
      mother: mother?.genotype ?? null,
      father: father?.genotype ?? null,
      offspring: animal.genotype,
    };
  });
  const usableFor = (birth: AnimalBirth, trait: (typeof ANIMAL_TRAITS)[number]) =>
    Boolean(birth.mother?.[trait] && birth.father?.[trait] && birth.offspring?.[trait]);
  const fitted = fitAnimalModel(births);
  const perTrait = ANIMAL_TRAITS.map((trait) => {
    const expressed = { bad: 0, okay: 0, good: 0 };
    const predicted = { bad: 0, okay: 0, good: 0 };
    let sampleSize = 0;
    for (const birth of births) {
      if (!usableFor(birth, trait)) continue;
      const pair = birth.offspring![trait]!;
      const grade = ANIMAL_GRADES[Math.max(ANIMAL_GRADES.indexOf(pair.a), ANIMAL_GRADES.indexOf(pair.b))];
      expressed[grade]++;
      const odds = offspringTraitOdds(birth.mother, birth.father, trait, fitted.params);
      for (const value of ANIMAL_GRADES) predicted[value] += odds[value];
      sampleSize++;
    }
    if (sampleSize > 0) {
      for (const value of ANIMAL_GRADES) predicted[value] /= sampleSize;
    }
    return { trait, expressed, predicted: sampleSize >= 30 ? predicted : null, sampleSize };
  });

  const relatedPairs = { related: 0, unrelated: 0, unknown: 0 };
  // ponytail: O(n²) unordered pairs; index marker groups if large pools make this costly.
  for (let i = 0; i < animals.length; i++) {
    for (let j = i + 1; j < animals.length; j++) {
      const left = animals[i].genotype?.lineage;
      const right = animals[j].genotype?.lineage;
      if (!left || !right) relatedPairs.unknown++;
      else if ([left.a, left.b].some((marker) => marker !== null && (marker === right.a || marker === right.b))) {
        relatedPairs.related++;
      } else relatedPairs.unrelated++;
    }
  }
  const notes = [
    ...describeAnimalModel(fitted.params),
    "Trait samples compare recorded offspring with both parents' trait genotypes known; predictions require 30 samples per trait.",
    "Relatedness counts unordered pairs of distinct animals; missing markers are unknown.",
  ];
  if (animals.some((animal) => animal.invalid)) notes.push("Malformed stored genotypes were treated as unknown.");
  return {
    coverage: {
      animals: animals.length,
      withBothParents,
      birthsUsable: births.filter((birth) => ANIMAL_TRAITS.some((trait) => usableFor(birth, trait))).length,
    },
    model: { version: ANIMAL_MODEL_VERSION, params: fitted.params, evidence: fitted.evidence },
    perTrait,
    relatedPairs,
    notes,
  };
}
