// Regenerates packages/shared/src/data/rust-items.json from the Corrosion Hour
// Rust item table (id -> shortname -> display name). Run: node scripts/refresh-rust-items.mjs
//
// ponytail: scrapes one HTML table; if the markup changes the row-count guard
// fails loudly instead of silently writing a half-empty map.
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "https://www.corrosionhour.com/rust-item-list/";
const TARGET = new URL("../packages/shared/src/data/rust-items.json", import.meta.url);
const MIN_ROWS = 1000;

const html = await (await fetch(SOURCE, { headers: { "user-agent": "Mozilla/5.0" } })).text();

const rows = [...html.matchAll(
  /<td class="ch-tbl-name">([^<]*)<\/td><td class="ch-tbl-short-name">([^<]*)<\/td><td class="ch-tbl-id">(-?\d+)<\/td>/g,
)].map((m) => ({ name: decode(m[1]), shortname: decode(m[2]), id: m[3] }));

if (rows.length < MIN_ROWS) {
  throw new Error(`Only parsed ${rows.length} rows (expected >= ${MIN_ROWS}) — source markup changed?`);
}

const existing = JSON.parse(readFileSync(TARGET, "utf8"));
const out = {};
// Keep local entries the source no longer lists (removed/legacy items) so nothing regresses.
for (const [id, v] of Object.entries(existing)) out[id] = { shortname: v.shortname, name: v.name };
const before = Object.keys(out).length;
for (const r of rows) out[r.id] = { shortname: r.shortname, name: r.name };

writeFileSync(TARGET, JSON.stringify(out));
console.log(`wrote ${Object.keys(out).length} items (${before} existing, ${rows.length} from source)`);

function decode(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}
