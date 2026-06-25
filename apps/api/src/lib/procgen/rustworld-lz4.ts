import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const rustworldEntry = require.resolve("rustworld");
const lz4ModulePath = path.join(path.dirname(rustworldEntry), "lz4", "lz4.js");

export const rustworldLz4 = require(lz4ModulePath) as {
  decompressBlock: (
    src: Uint8Array,
    dst: Uint8Array,
    sIndex: number,
    sLength: number,
    dIndex: number,
  ) => number;
};
