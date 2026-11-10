import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parsePatchFile } = require("../node_modules/patch-package/dist/patch/parse.js");
const patchPath = new URL("../patches/@liamcottle+rustplus.js+2.5.0.patch", import.meta.url);
const patchText = fs.readFileSync(patchPath, "utf8");

let parsed;
try {
  parsed = parsePatchFile(patchText);
} catch (error) {
  console.error(`rustplus patch does not parse: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const patches = parsed.filter((entry) => entry.type === "patch");
const byPath = new Map(patches.map((entry) => [entry.path, entry]));
assert.equal(patches.length, 3);
assert.deepEqual(
  [...byPath.keys()].sort(),
  [
    "node_modules/@liamcottle/rustplus.js/camera.js",
    "node_modules/@liamcottle/rustplus.js/rustplus.js",
    "node_modules/@liamcottle/rustplus.js/rustplus.proto",
  ],
);
assert.equal(byPath.get("node_modules/@liamcottle/rustplus.js/camera.js").hunks.length, 2);
assert.equal(byPath.get("node_modules/@liamcottle/rustplus.js/rustplus.js").hunks.length, 7);
assert.equal(byPath.get("node_modules/@liamcottle/rustplus.js/rustplus.proto").hunks.length, 4);

const rustplusSource = byPath
  .get("node_modules/@liamcottle/rustplus.js/rustplus.js")
  .hunks.map((hunk) => hunk.source)
  .join("\n");
assert.match(rustplusSource, /companion = null/);
assert.match(rustplusSource, /rustplus\.auth\.v1/);
assert.match(rustplusSource, /followRedirects: false/);
assert.match(rustplusSource, /Rust\+ relay setup failed/);

const cameraSource = byPath
  .get("node_modules/@liamcottle/rustplus.js/camera.js")
  .hunks.map((hunk) => hunk.source)
  .join("\n");
assert.match(cameraSource, /45_000/);
assert.match(cameraSource, /15_000/);

const protoSource = byPath
  .get("node_modules/@liamcottle/rustplus.js/rustplus.proto")
  .hunks.map((hunk) => hunk.source)
  .join("\n");
assert.match(protoSource, /optional uint32 queuedPlayers/);
assert.match(protoSource, /optional bool itemIsBlueprint/);

const { executeEffects } = require("../node_modules/patch-package/dist/patch/apply.js");
const { reversePatch } = require("../node_modules/patch-package/dist/patch/reverse.js");
const tempBase = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Temp", "opencode") : os.tmpdir();
const temp = fs.mkdtempSync(path.join(tempBase, "rustplus-patch-"));
try {
  for (const entry of patches) {
    const destination = path.join(temp, entry.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(new URL(`../${entry.path}`, import.meta.url), destination);
  }
  executeEffects(reversePatch(parsed), { cwd: temp, dryRun: false, bestEffort: false });
  executeEffects(parsed, { cwd: temp, dryRun: false, bestEffort: false });
  for (const entry of patches) {
    assert.deepEqual(fs.readFileSync(path.join(temp, entry.path)), fs.readFileSync(new URL(`../${entry.path}`, import.meta.url)));
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log("rustplus patch parses, reverses and reapplies with patch-package; all hunks retained");
