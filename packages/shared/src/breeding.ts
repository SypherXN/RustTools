export type BreedingKind = "crop" | "animal";
export type BreedingSex = "female" | "male" | "unknown";
export type BreedingAnimalSpecies = "cow" | "sheep";

export const BREEDING_KINDS: readonly BreedingKind[] = ["crop", "animal"];
export const BREEDING_SEXES: readonly BreedingSex[] = ["female", "male", "unknown"];
export const BREEDING_ANIMAL_SPECIES: readonly BreedingAnimalSpecies[] = ["cow", "sheep"];

export const BREEDING_NAME_MAX_LEN = 80;
export const BREEDING_SPECIES_MAX_LEN = 40;
export const BREEDING_SERVER_LABEL_MAX_LEN = 64;
export const BREEDING_LOCATION_MAX_LEN = 200;
export const BREEDING_TRAITS_MAX_LEN = 500;
export const BREEDING_POTENTIAL_MAX_LEN = 120;
export const BREEDING_NOTES_MAX_LEN = 1000;
export const BREEDING_GENE_COUNT = 6;
export const BREEDING_CROP_GENES_PATTERN = /^[GYHWX]{6}$/;
export const BREEDING_QUANTITY_MAX = 1_000_000;

export interface BreedingEntry {
  id: string;
  kind: BreedingKind;
  name: string;
  /** Crop: normalized lowercase crop name (berry variants allowed). Animal: cow | sheep. */
  species: string;
  /** Required server + wipe tag, e.g. "EU Main - monthly". */
  serverLabel: string;
  /** Six GYHWX genes for crops; blank for animals. */
  genes: string;
  /** Observed animal traits, kept verbatim. */
  traits: string;
  /** Integer >= 0. Animals are always 1. */
  quantity: number;
  /** Pickup details, required. */
  location: string;
  available: boolean;
  sex: BreedingSex;
  /** Observed potential, stored verbatim. Never an invented range. */
  potential: string;
  motherId: string | null;
  fatherId: string | null;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Mutable fields a create request may supply; metadata is server-owned. */
export type BreedingEntryInput = Omit<
  BreedingEntry,
  "id" | "createdBy" | "createdAt" | "updatedAt"
>;

/** PATCH fields: everything mutable except the immutable `kind`. */
export type BreedingEntryPatch = Partial<Omit<BreedingEntryInput, "kind">>;

export function isBreedingKind(value: unknown): value is BreedingKind {
  return value === "crop" || value === "animal";
}

export function isBreedingSex(value: unknown): value is BreedingSex {
  return value === "female" || value === "male" || value === "unknown";
}

export function isBreedingAnimalSpecies(value: string): value is BreedingAnimalSpecies {
  return value === "cow" || value === "sheep";
}

/** Crop species match lowercase; animals keep the fixed lowercase species names. */
export function normalizeBreedingSpecies(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeBreedingGenes(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidCropGenes(value: string): boolean {
  return BREEDING_CROP_GENES_PATTERN.test(normalizeBreedingGenes(value));
}
