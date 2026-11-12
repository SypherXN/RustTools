import {
  type AnimalGenotype,
  type AnimalGrade,
  type AnimalModelParams,
  type AnimalTrait,
  type BreedingEntry,
  type BreedingEntryInput,
  type fitAnimalModel,
} from "@rusttools/shared";

/** API/storage shape, distinct from the shared inheritance model's flat traits. */
export interface AnimalGenotypeWire {
  traits: Partial<Pick<AnimalGenotype, AnimalTrait>>;
  markers?: [string, string];
}

export type BreedingWireEntry = BreedingEntry & { animalGenotype?: AnimalGenotypeWire | null };
export type BreedingWireInput = BreedingEntryInput & { animalGenotype?: AnimalGenotypeWire };

export function animalGenotypeFromWire(wire: AnimalGenotypeWire | null | undefined): AnimalGenotype {
  return {
    dung: wire?.traits.dung ?? null,
    yield: wire?.traits.yield ?? null,
    fertility: wire?.traits.fertility ?? null,
    hardiness: wire?.traits.hardiness ?? null,
    lineage: wire?.markers ? { a: wire.markers[0], b: wire.markers[1] } : null,
  };
}

export interface AnimalAnalysis {
  coverage: { animals: number; withBothParents: number; birthsUsable: number };
  model: {
    version: string;
    params: AnimalModelParams;
    evidence: ReturnType<typeof fitAnimalModel>["evidence"];
  };
  perTrait: {
    trait: AnimalTrait;
    expressed: Record<AnimalGrade, number>;
    predicted: Record<AnimalGrade, number> | null;
    sampleSize: number;
  }[];
  relatedPairs: { related: number; unrelated: number; unknown: number };
  notes: string[];
}

/** Manual availability: a flagged-out entry or a tapped-out quantity is not available. */
export function isBreedingAvailable(entry: BreedingEntry): boolean {
  return entry.available && entry.quantity > 0;
}

export function breedingKindLabel(entry: BreedingEntry): string {
  if (entry.kind === "crop") return "Crop";
  return entry.species === "cow" ? "Cow" : "Sheep";
}

export function breedingSexLabel(entry: BreedingEntry): string {
  if (entry.sex === "female") return "Female";
  if (entry.sex === "male") return "Male";
  return "Sex unknown";
}

export function breedingSpeciesLabel(entry: BreedingEntry): string {
  if (entry.kind === "animal") return entry.species === "cow" ? "Cow" : "Sheep";
  return entry.species;
}

export function formatBreedingUpdated(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}


export function breedingById(entries: BreedingEntry[]): Map<string, BreedingEntry> {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

/** Every recorded ancestor of an entry (its parents, and their parents, and so on). */
export function breedingAncestorIds(entries: BreedingEntry[], rootId: string): Set<string> {
  const byId = breedingById(entries);
  const root = byId.get(rootId);
  const seen = new Set<string>();
  if (!root) return seen;
  const stack: string[] = [root.motherId, root.fatherId].filter((id): id is string => Boolean(id));
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id) || id === rootId) continue;
    seen.add(id);
    const ancestor = byId.get(id);
    if (ancestor?.motherId) stack.push(ancestor.motherId);
    if (ancestor?.fatherId) stack.push(ancestor.fatherId);
  }
  return seen;
}

/**
 * Known related-pair warning between two animals, or null when their recorded
 * lineage shows no relation. Unrecorded ancestry is never treated as unrelated.
 */
export function breedingPairWarning(
  entries: BreedingEntry[],
  idA: string,
  idB: string,
): string | null {
  if (idA === idB) return null;
  const byId = breedingById(entries);
  const a = byId.get(idA);
  const b = byId.get(idB);
  if (!a || !b) return null;

  const ancestorsOfA = breedingAncestorIds(entries, idA);
  if (ancestorsOfA.has(idB)) return `${b.name} is a known ancestor of ${a.name}.`;
  const ancestorsOfB = breedingAncestorIds(entries, idB);
  if (ancestorsOfB.has(idA)) return `${a.name} is a known ancestor of ${b.name}.`;

  const sharedNames = [...ancestorsOfA]
    .filter((id) => ancestorsOfB.has(id))
    .map((id) => byId.get(id)?.name ?? "a record");
  if (sharedNames.length === 1) return `Both share the known ancestor ${sharedNames[0]}.`;
  if (sharedNames.length > 1) {
    return `Both share known ancestors: ${sharedNames.slice(0, 4).join(", ")}.`;
  }
  return null;
}

/** Cycle guard: would selecting `parentId` for `selfId` loop back to itself? */
export function breedingWouldCycle(
  entries: BreedingEntry[],
  selfId: string,
  parentId: string,
): boolean {
  return selfId.length > 0 && breedingAncestorIds(entries, parentId).has(selfId);
}
