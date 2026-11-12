export const DEFAULT_GOD_CLONE_GENOME = "GGGYYY";

export const CROP_GOD_CLONES: Readonly<Record<string, string>> = {
  hemp: DEFAULT_GOD_CLONE_GENOME,
  corn: DEFAULT_GOD_CLONE_GENOME,
  potato: DEFAULT_GOD_CLONE_GENOME,
  pumpkin: DEFAULT_GOD_CLONE_GENOME,
  wheat: DEFAULT_GOD_CLONE_GENOME,
  "red berry": DEFAULT_GOD_CLONE_GENOME,
  "blue berry": DEFAULT_GOD_CLONE_GENOME,
  "green berry": DEFAULT_GOD_CLONE_GENOME,
  "yellow berry": DEFAULT_GOD_CLONE_GENOME,
  "white berry": DEFAULT_GOD_CLONE_GENOME,
  "black berry": DEFAULT_GOD_CLONE_GENOME,
};

export function godCloneGenomeForSpecies(species: string): string {
  return CROP_GOD_CLONES[species.trim().toLowerCase()] ?? DEFAULT_GOD_CLONE_GENOME;
}

export function isGodCloneGenome(species: string, genes: string): boolean {
  const normalized = genes.trim().toUpperCase();
  if (!/^[GYHWX]{6}$/.test(normalized)) return false;
  return [...normalized].sort().join("") === [...godCloneGenomeForSpecies(species)].sort().join("");
}
