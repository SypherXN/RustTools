// Run after building @rusttools/db and @rusttools/api:
//   node scripts/check-animal-analysis-api.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Sqlite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routesPath = path.join(repoRoot, "apps/api/dist/routes/breeding.js");
if (!existsSync(routesPath)) throw new Error("Missing apps/api/dist — build before this check.");
process.env.NODE_ENV = "development";
process.env.DISCORD_GUILD_ID = "check-guild";
process.env.DISCORD_BOT_TOKEN = "check-bot-token";
process.env.DISCORD_ROLE_ADMIN = "role-admin";
process.env.DISCORD_ROLE_SWITCH = "role-switch";
process.env.DISCORD_ROLE_VIEW = "role-view";
process.env.SESSION_SECRET = "check-session-secret";
const roleAssignments = new Map([
  ["view-user", ["role-view"]],
  ["switch-user", ["role-switch"]],
]);
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const match = String(url).match(/\/guilds\/[^/]+\/members\/([^/]+)$/);
  if (!match) throw new Error(`Unexpected fetch in animal analysis check: ${url}`);
  return {
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ roles: roleAssignments.get(match[1]) ?? [] }),
  };
};
let checks = 0;
function check(condition, message) { checks++; assert.ok(condition, message); }
function equal(actual, expected, message) { checks++; assert.deepEqual(actual, expected, message); }
const preferredTempRoot = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "Temp", "opencode") : null;
const tempRoot = preferredTempRoot && existsSync(preferredTempRoot) ? preferredTempRoot : os.tmpdir();
const dir = mkdtempSync(path.join(tempRoot, "animal-analysis-check-"));
const dbPath = path.join(dir, "animals.db");
const dbUrl = `file:${dbPath}`;
let db;
let app;
try {
  // Apply the real pre-0026 migrations, then seed a parent and children before upgrading.
  const migrations = path.join(repoRoot, "packages/db/drizzle");
  const journal = JSON.parse(readFileSync(path.join(migrations, "meta/_journal.json"), "utf8"));
  const previous = { ...journal, entries: journal.entries.filter((entry) => entry.idx < 27) };
  check(previous.entries.at(-1).tag === "0025_companion_server_id", "baseline ends at 0025");
  const baselineFolder = path.join(dir, "baseline");
  mkdirSync(path.join(baselineFolder, "meta"), { recursive: true });
  writeFileSync(path.join(baselineFolder, "meta/_journal.json"), JSON.stringify(previous));
  for (const entry of previous.entries) {
    copyFileSync(path.join(migrations, `${entry.tag}.sql`), path.join(baselineFolder, `${entry.tag}.sql`));
  }
  const legacy = new Sqlite(dbPath);
  try {
    legacy.pragma("foreign_keys = ON");
    migrate(drizzle(legacy), { migrationsFolder: baselineFolder });
    const insert = legacy.prepare(`INSERT INTO breeding_entries
      (id, kind, name, species, server_label, location, traits, mother_id, created_by, created_at, updated_at)
      VALUES (?, 'animal', ?, 'cow', 'Check wipe', 'Barn', 'legacy traits', ?, 'Legacy', 1, 1)`);
    insert.run("legacy-mother", "Legacy mother", null);
    insert.run("legacy-child-1", "Legacy child one", "legacy-mother");
    insert.run("legacy-child-2", "Legacy child two", "legacy-mother");
  } finally { legacy.close(); }
  const dbModule = await import("@rusttools/db");
  dbModule.runMigrations(dbUrl);
  dbModule.runMigrations(dbUrl);
  db = dbModule.createDatabase(dbUrl);
  const preserved = await db.select().from(dbModule.breedingEntries);
  check(preserved.length === 3, "migration preserves existing parent and children");
  check(preserved.every((row) => row.animalGenotypeJson === null && row.traits === "legacy traits"), "legacy data unchanged and genotypes null");
  check(preserved.filter((row) => row.motherId === "legacy-mother").length === 2, "migration preserves child references");
  const now = new Date();
  const VIEW_TOKEN = "check-view-token";
  const SWITCH_TOKEN = "check-switch-token";
  for (const [token, discordId] of [[VIEW_TOKEN, "view-user"], [SWITCH_TOKEN, "switch-user"]]) {
    const userId = `user-${discordId}`;
    await db.insert(dbModule.users).values({ id: userId, discordId, discordUsername: discordId, createdAt: now, updatedAt: now });
    await db.insert(dbModule.sessions).values({
      id: `session-${discordId}`, userId,
      refreshTokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 3600000), createdAt: now,
    });
  }
  const Fastify = (await import("fastify")).default;
  const cookie = (await import("@fastify/cookie")).default;
  const { registerBreedingRoutes } = await import(pathToFileURL(routesPath).href);
  app = Fastify();
  await app.register(cookie, { secret: process.env.SESSION_SECRET });
  await registerBreedingRoutes(app, { db });
  await app.ready();
  async function call(method, url, { token, payload } = {}) {
    const headers = {};
    if (token) headers.cookie = `rusttools_refresh=${token}`;
    if (payload !== undefined) headers["content-type"] = "application/json";
    const res = await app.inject({ method, url, headers, payload: payload === undefined ? undefined : JSON.stringify(payload) });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  }
  const ANALYSIS = "/breeding/analysis/animals";
  let res = await call("GET", ANALYSIS);
  equal(res.status, 401, "analysis needs a session");
  res = await call("GET", ANALYSIS, { token: VIEW_TOKEN });
  equal(res.status, 200, "view capability permits analysis");
  equal(res.body.coverage, { animals: 3, withBothParents: 0, birthsUsable: 0 }, "legacy coverage");
  check(res.body.perTrait.every((trait) => trait.predicted === null && trait.sampleSize === 0), "empty samples have no predictions");
  const base = { kind: "animal", species: "cow", serverLabel: "Check wipe", location: "Barn", quantity: 1 };
  const genotype = (a, b, markers) => ({
    traits: Object.fromEntries(["dung", "yield", "fertility", "hardiness"].map((trait) => [trait, { a, b }])),
    markers,
  });
  const motherGenotype = genotype("good", "okay", ["m3", "m9"]);
  const crop = { ...base, kind: "crop", species: "hemp", name: "Crop", genes: "GGGGGG" };
  for (const [label, payload] of [
    ["bad grade", { ...base, name: "Invalid", animalGenotype: genotype("excellent", "okay", ["m1", "m2"]) }],
    ["three markers", { ...base, name: "Invalid", animalGenotype: { ...motherGenotype, markers: ["m1", "m2", "m3"] } }],
    ["long marker", { ...base, name: "Invalid", animalGenotype: { traits: {}, markers: ["123456789", "m2"] } }],
    ["empty marker", { ...base, name: "Invalid", animalGenotype: { traits: {}, markers: ["", "m2"] } }],
    ["numeric marker", { ...base, name: "Invalid", animalGenotype: { traits: {}, markers: [1, "m2"] } }],
    ["unknown key", { ...base, name: "Invalid", animalGenotype: { ...motherGenotype, secret: "no" } }],
    ["unknown trait", { ...base, name: "Invalid", animalGenotype: { traits: { speed: null } } }],
    ["unknown allele key", { ...base, name: "Invalid", animalGenotype: { traits: { dung: { a: "good", b: "bad", c: "okay" } } } }],
    ["missing allele", { ...base, name: "Invalid", animalGenotype: { traits: { dung: { a: "good" } } } }],
    ["wrong traits type", { ...base, name: "Invalid", animalGenotype: { traits: [] } }],
    ...[null, [], "{}", 42].map((animalGenotype) => ["non-object genotype", { ...base, name: "Invalid", animalGenotype }]),
    ["crop genotype", { ...crop, animalGenotype: motherGenotype }],
  ]) {
    res = await call("POST", "/breeding", { token: SWITCH_TOKEN, payload });
    equal(res.status, 400, `${label} rejected`);
  }
  res = await call("POST", "/breeding", { token: SWITCH_TOKEN, payload: crop });
  equal(res.status, 201, "ordinary crops remain valid");
  check(!Object.hasOwn(res.body, "animalGenotype"), "crop response shape unchanged");
  res = await call("PATCH", `/breeding/${res.body.id}`, { token: SWITCH_TOKEN, payload: { animalGenotype: motherGenotype } });
  equal(res.status, 400, "crop genotype also rejected on PATCH");
  async function addAnimal(name, sex, animalGenotype, parents = {}) {
    const result = await call("POST", "/breeding", {
      token: SWITCH_TOKEN, payload: { ...base, name, sex, animalGenotype, ...parents },
    });
    equal(result.status, 201, `${name} created`);
    equal(result.body.animalGenotype, animalGenotype, `${name} genotype round-trips`);
    return result.body;
  }
  const mother = await addAnimal("Grandmother", "female", motherGenotype);
  const father = await addAnimal("Grandfather", "male", genotype("good", "bad", ["m4", "m8"]));
  const parents = { motherId: mother.id, fatherId: father.id };
  const daughter = await addAnimal("Daughter", "female", genotype("okay", "bad", ["m3", "m8"]), parents);
  const son = await addAnimal("Son", "male", genotype("good", "bad", ["m3", "m4"]), parents);
  const grandchild = await addAnimal("Grandchild", "unknown", genotype("bad", "bad", ["m8", "m4"]), {
    motherId: daughter.id, fatherId: son.id,
  });
  const cleared = { ...motherGenotype, traits: { ...motherGenotype.traits, fertility: null } };
  res = await call("PATCH", `/breeding/${mother.id}`, { token: SWITCH_TOKEN, payload: { animalGenotype: cleared } });
  equal(res.status, 200, "genotype PATCH succeeds");
  equal(res.body.animalGenotype, cleared, "PATCH can null an individual trait");
  res = await call("PATCH", `/breeding/${mother.id}`, { token: SWITCH_TOKEN, payload: { notes: "Edited" } });
  equal(res.body.animalGenotype, cleared, "unrelated PATCH preserves genotype");
  res = await call("PATCH", `/breeding/${mother.id}`, { token: SWITCH_TOKEN, payload: { animalGenotype: null } });
  equal(res.status, 400, "explicit null genotype rejected");
  res = await call("PATCH", `/breeding/${mother.id}`, { token: SWITCH_TOKEN, payload: { kind: "crop" } });
  equal(res.status, 400, "kind remains immutable");
  res = await call("GET", "/breeding", { token: VIEW_TOKEN });
  equal(res.body.entries.find((entry) => entry.id === mother.id).animalGenotype, cleared, "GET uses the same genotype codec");
  equal(res.body.entries.find((entry) => entry.id === "legacy-mother").animalGenotype, null, "legacy animals serialize null");
  const beforeAnalysis = await db.select().from(dbModule.breedingEntries);
  equal(JSON.parse(beforeAnalysis.find((row) => row.id === mother.id).animalGenotypeJson), cleared, "storage retains traits plus markers, not model lineage");
  res = await call("GET", ANALYSIS, { token: VIEW_TOKEN });
  equal(res.status, 200, "analysis succeeds");
  equal(res.body.coverage, { animals: 8, withBothParents: 3, birthsUsable: 3 }, "coverage counts linked usable births");
  equal(res.body.model.version, "rustlite-v1", "model version returned");
  equal(res.body.model.evidence.violations, 0, "seeded three-generation pedigree has violations: 0");
  check(res.body.perTrait.every((trait) => trait.predicted === null && trait.sampleSize < 30), "predictions suppressed under 30 samples");
  equal(res.body.perTrait.find((trait) => trait.trait === "dung").expressed, { bad: 1, okay: 1, good: 1 }, "expressed grades from comparable births");
  equal(res.body.perTrait.find((trait) => trait.trait === "fertility").sampleSize, 1, "null parental trait removes only that trait's samples");
  equal(res.body.relatedPairs, { related: 8, unrelated: 2, unknown: 18 }, "lineage matching excludes self-pairs and keeps missing markers unknown");
  check(Array.isArray(res.body.notes) && res.body.notes.length > 0, "model notes returned");
  const serialized = JSON.stringify(res.body);
  for (const sensitive of [VIEW_TOKEN, SWITCH_TOKEN, process.env.DISCORD_BOT_TOKEN, process.env.SESSION_SECRET,
    mother.id, father.id, daughter.id, son.id, grandchild.id, "Grandmother", "Grandfather"]) {
    check(!serialized.includes(sensitive), "analysis exposes no secrets or animal identity");
  }
  function noSecretFields(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      check(!/token|secret|password|authorization|cookie/i.test(key), `no sensitive response field: ${key}`);
      noSecretFields(child);
    }
  }
  noSecretFields(res.body);
  equal(await db.select().from(dbModule.breedingEntries), beforeAnalysis, "analysis is read-only");
  // Exercise the exact publication threshold, not just the suppressed branch.
  for (let i = 0; i < 27; i++) {
    await addAnimal(`Extra calf ${i}`, "unknown", genotype("okay", "bad", ["m3", "m8"]), parents);
  }
  res = await call("GET", ANALYSIS, { token: VIEW_TOKEN });
  const dung = res.body.perTrait.find((trait) => trait.trait === "dung");
  equal(dung.sampleSize, 30, "threshold sample count");
  check(dung.predicted !== null && Math.abs(Object.values(dung.predicted).reduce((a, b) => a + b, 0) - 1) < 1e-9, "30 samples publish normalized predicted probabilities");
  equal(res.body.model.evidence.violations, 0, "additional valid births introduce no violations");
  const previousCoverage = res.body.coverage;
  const previousUnknown = res.body.relatedPairs.unknown;
  await addAnimal("Unobserved traits", "unknown", { traits: { dung: null } });
  res = await call("GET", ANALYSIS, { token: VIEW_TOKEN });
  equal(res.body.coverage, { ...previousCoverage, animals: previousCoverage.animals + 1 }, "omitted traits and markers remain unobserved");
  equal(res.body.relatedPairs.unknown, previousUnknown + previousCoverage.animals, "absent markers map to null lineage, not invented identifiers");
} finally {
  await app?.close();
  db?.$client.close();
  globalThis.fetch = originalFetch;
  try { rmSync(dir, { recursive: true, force: true }); } catch {
    // Windows can retain migration handles until process exit; this directory is disposable.
  }
}
console.log(`animal analysis API check passed (${checks} assertions)`);
