/**
 * Standalone procgen parse worker — spawned with a raised heap limit so the main API
 * stays lean on small VMs (e.g. Oracle E2.1.Micro). Writes artifacts to outDir.
 *
 * Usage: node procgen-parse-worker.js <source.map> <outputDir>
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { buildProcgenArtifacts, PROCGEN_PARSER_VERSION } from "./lib/procgen/parse.js";
import type { ProcgenOverlayId } from "./lib/procgen/types.js";

const OVERLAY_IDS: ProcgenOverlayId[] = [
  "building-blocked",
  "heatmap-ores",
  "heatmap-stones",
  "heatmap-sulfur",
];

async function writeRgbaPng(filePath: string, rgba: Uint8Array, size: number): Promise<void> {
  await sharp(Buffer.from(rgba), {
    raw: { width: size, height: size, channels: 4 },
  })
    .png()
    .toFile(filePath);
}

async function main(): Promise<void> {
  const sourcePath = process.argv[2];
  const outDir = process.argv[3];
  if (!sourcePath || !outDir) {
    console.error("Usage: procgen-parse-worker <source.map> <outputDir>");
    process.exit(2);
  }

  await mkdir(outDir, { recursive: true });
  const mapBuffer = await readFile(sourcePath);
  const parsed = buildProcgenArtifacts(mapBuffer);

  for (const overlayId of OVERLAY_IDS) {
    const rgba = parsed.overlays[overlayId];
    await writeRgbaPng(path.join(outDir, `overlay-${overlayId}.png`), rgba, parsed.overlaySize);
  }

  await writeFile(
    path.join(outDir, "meta.json"),
    JSON.stringify({
      worldSize: parsed.worldSize,
      version: parsed.version,
      overlaySize: parsed.overlaySize,
      parserVersion: PROCGEN_PARSER_VERSION,
    }),
  );
  await writeFile(path.join(outDir, "paths.json"), JSON.stringify(parsed.paths));
  await writeFile(path.join(outDir, "prefabs.json"), JSON.stringify(parsed.prefabs));
  await writeFile(path.join(outDir, "height.json"), JSON.stringify(parsed.height));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
