import type { CropGene } from "@rusttools/shared";

type TileValue = string | readonly CropGene[];

const GENE_CLASS: Record<string, string> = {
  G: "gene-g",
  Y: "gene-y",
  H: "gene-h",
  W: "gene-w",
  X: "gene-x",
};

function tileClass(tile: string): string {
  return GENE_CLASS[tile[0]] ?? "";
}

/**
 * Six slot tiles. Pass a plain genome string for a certain result, or an
 * array of per-slot option lists to show ties ("G/Y").
 */
export function GeneStrip({ genes }: { genes: string | readonly TileValue[] }) {
  const tiles: string[] =
    typeof genes === "string"
      ? [...genes.trim().toUpperCase()]
      : genes.map((options) => [...options].sort().join("/"));

  if (tiles.length === 0 || tiles.some((tile) => !tile)) return null;

  return (
    <span className="gene-strip" role="img" aria-label={`Genes: ${tiles.join(", ")}`}>
      {tiles.map((tile, index) => (
        <span key={index} className={`gene-tile ${tileClass(tile)}`}>
          {tile}
        </span>
      ))}
    </span>
  );
}
