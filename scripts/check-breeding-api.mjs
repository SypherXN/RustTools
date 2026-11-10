// Focused backend check for the shared breeding pool.
// Run after `npm run build` (needs @rusttools/db + apps/api dist):
//   node scripts/check-breeding-api.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routesPath = path.join(repoRoot, "apps/api/dist/routes/breeding.js");
const adminRoutesPath = path.join(repoRoot, "apps/api/dist/routes/admin.js");
if (!existsSync(routesPath) || !existsSync(adminRoutesPath)) {
  console.error("Missing apps/api/dist — run `npm run build` before this check.");
  process.exit(1);
}

process.env.NODE_ENV = "development";
process.env.DISCORD_GUILD_ID = "check-guild";
process.env.DISCORD_BOT_TOKEN = "check-bot-token";
process.env.DISCORD_ROLE_ADMIN = "role-admin";
process.env.DISCORD_ROLE_SWITCH = "role-switch";
process.env.DISCORD_ROLE_VIEW = "role-view";
process.env.SESSION_SECRET = "check-session-secret";

// Discord role lookups are the only network path used by requireCapability.
const roleAssignments = new Map([
  ["view-user", ["role-view"]],
  ["switch-user", ["role-switch"]],
  ["admin-user", ["role-admin"]],
]);
globalThis.fetch = async (url) => {
  const match = String(url).match(/\/guilds\/[^/]+\/members\/([^/]+)$/);
  if (!match) throw new Error(`Unexpected fetch in breeding check: ${url}`);
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ roles: roleAssignments.get(match[1]) ?? [] }),
  };
};

let checks = 0;
function check(condition, message) {
  checks += 1;
  assert.ok(condition, message);
}

const preferredTempRoot =
  process.platform === "win32" && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Temp", "opencode")
    : null;
const tempRoot =
  preferredTempRoot && existsSync(preferredTempRoot) ? preferredTempRoot : os.tmpdir();
const dir = mkdtempSync(path.join(tempRoot, "breeding-check-"));
const dbUrl = `file:${path.join(dir, "breeding.db")}`;

const dbModule = await import("@rusttools/db");
const { createDatabase, runMigrations, users, sessions } = dbModule;
runMigrations(dbUrl);
runMigrations(dbUrl); // idempotent: journal must not re-apply
const db = createDatabase(dbUrl);

const now = new Date();
const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
async function addSession(token, discordId, discordUsername) {
  const userId = `user-${discordId}`;
  await db.insert(users).values({
    id: userId,
    discordId,
    discordUsername,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sessions).values({
    id: `session-${discordId}`,
    userId,
    refreshTokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt,
    createdAt: now,
  });
}
const VIEW_TOKEN = "check-view-token";
const SWITCH_TOKEN = "check-switch-token";
const ADMIN_TOKEN = "check-admin-token";
await addSession(VIEW_TOKEN, "view-user", "Viewer");
await addSession(SWITCH_TOKEN, "switch-user", "Switcher");
await addSession(ADMIN_TOKEN, "admin-user", "Admin");

const Fastify = (await import("fastify")).default;
const cookie = (await import("@fastify/cookie")).default;
const { registerBreedingRoutes } = await import(pathToFileURL(routesPath).href);
const { registerAdminRoutes } = await import(pathToFileURL(adminRoutesPath).href);

const app = Fastify();
await app.register(cookie, { secret: process.env.SESSION_SECRET });
await registerBreedingRoutes(app, { db });
await app.ready();

async function injectCall(appRef, method, url, { token, payload } = {}) {
  const headers = {};
  if (token) headers.cookie = `rusttools_refresh=${token}`;
  if (payload !== undefined) headers["content-type"] = "application/json";
  const res = await appRef.inject({
    method,
    url,
    headers,
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
  let body = null;
  try {
    body = res.body ? JSON.parse(res.body) : null;
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body };
}
const call = (method, url, opts) => injectCall(app, method, url, opts);

const SERVER = "EU Main - monthly";
const crop = {
  kind: "crop",
  name: "Hemp field",
  species: " Hemp ",
  serverLabel: SERVER,
  genes: "gYhWxG",
  location: "Vending machine 3",
  quantity: 6,
};
const mother = {
  kind: "animal",
  name: "Bessie",
  species: "cow",
  serverLabel: SERVER,
  genes: "",
  location: "Large barn",
  sex: "female",
  traits: "Grey, calm",
  potential: "2x milk",
  quantity: 1,
};
const father = {
  kind: "animal",
  name: "Ferdinand",
  species: "cow",
  serverLabel: SERVER,
  genes: "",
  location: "Large barn",
  sex: "male",
  quantity: 1,
};

// --- auth + capability gates -------------------------------------------------
let res = await call("GET", "/breeding");
check(res.status === 401, "GET without a session must be 401");
res = await call("POST", "/breeding", { payload: crop });
check(res.status === 401, "POST without a session must be 401");
res = await call("GET", "/breeding", { token: VIEW_TOKEN });
check(res.status === 200 && Array.isArray(res.body.entries), "view user can list");
check(res.body.entries.length === 0, "pool starts empty");
res = await call("POST", "/breeding", { token: VIEW_TOKEN, payload: crop });
check(res.status === 403, "view-only user cannot create");
res = await call("POST", "/breeding", { token: SWITCH_TOKEN, payload: {} });
check(res.status === 400, "missing required fields rejected");

// --- strict malformed payloads ----------------------------------------------
for (const [label, payload] of [
  ["null body", null],
  ["array body", []],
  ["non-boolean available", { ...crop, available: "true" }],
  ["numeric string quantity", { ...crop, quantity: "6" }],
  ["non-integer quantity", { ...crop, quantity: 1.5 }],
  ["negative quantity", { ...crop, quantity: -1 }],
  ["unknown field", { ...crop, colour: "blue" }],
  ["non-string name", { ...crop, name: 42 }],
  ["null name", { ...crop, name: null }],
  ["missing location", { ...crop, location: undefined }],
  ["bad genes length", { ...crop, genes: "GYHWX" }],
  ["bad genes letters", { ...crop, genes: "GYHWXA" }],
  ["bad kind", { ...crop, kind: "tree" }],
  ["bad sex", { ...crop, sex: "other" }],
  ["bad animal species", { ...crop, kind: "animal", species: "horse", genes: "" }],
  ["animal with genes", { ...mother, genes: "GYHWXG" }],
  ["animal quantity 2", { ...mother, quantity: 2 }],
]) {
  res = await call("POST", "/breeding", { token: SWITCH_TOKEN, payload });
  check(res.status === 400, `${label} must be rejected with 400 (got ${res.status})`);
}

// --- create + shape ----------------------------------------------------------
res = await call("POST", "/breeding", { token: SWITCH_TOKEN, payload: crop });
check(res.status === 201, `crop create returns 201 (got ${res.status})`);
const cropEntry = res.body;
check(cropEntry.species === "hemp", "crop species normalized lowercase");
check(cropEntry.genes === "GYHWXG", "crop genes normalized uppercase");
check(cropEntry.quantity === 6, "crop quantity kept");
check(cropEntry.available === true, "available defaults true");
check(cropEntry.sex === "unknown", "sex defaults unknown");
check(cropEntry.traits === "", "traits default blank");
check(cropEntry.potential === "", "potential default blank");
check(cropEntry.motherId === null && cropEntry.fatherId === null, "parents default null");
check(cropEntry.createdBy === "Switcher", "createdBy comes from the session user");
check(typeof cropEntry.createdAt === "string" && typeof cropEntry.updatedAt === "string", "ISO timestamps");
check(
  ["id", "kind", "name", "species", "serverLabel", "genes", "traits", "quantity", "location",
    "available", "sex", "potential", "motherId", "fatherId", "notes", "createdBy",
    "createdAt", "updatedAt"].every((key) => key in cropEntry),
  "entry exposes the full contract shape",
);

res = await call("POST", "/breeding", { token: SWITCH_TOKEN, payload: mother });
check(res.status === 201, "mother created");
const motherEntry = res.body;
check(motherEntry.traits === "Grey, calm", "observed traits kept verbatim");
check(motherEntry.potential === "2x milk", "observed potential kept verbatim");
res = await call("POST", "/breeding", { token: SWITCH_TOKEN, payload: father });
check(res.status === 201, "father created");
const fatherEntry = res.body;

// --- partial update ----------------------------------------------------------
res = await call("PATCH", `/breeding/${cropEntry.id}`, {
  token: SWITCH_TOKEN,
  payload: { notes: "Cloned twice", available: false },
});
check(res.status === 200, "partial PATCH returns entry directly");
check(res.body.notes === "Cloned twice", "PATCH changed notes");
check(res.body.available === false, "PATCH changed available");
check(res.body.quantity === 6 && res.body.genes === "GYHWXG", "PATCH kept untouched fields");
res = await call("PATCH", `/breeding/${cropEntry.id}`, {
  token: SWITCH_TOKEN,
  payload: { kind: "animal" },
});
check(res.status === 400, "kind is immutable");
res = await call("PATCH", `/breeding/${cropEntry.id}`, {
  token: SWITCH_TOKEN,
  payload: { kind: "crop" },
});
check(res.status === 200, "kind may be echoed unchanged");
res = await call("PATCH", `/breeding/${cropEntry.id}`, {
  token: SWITCH_TOKEN,
  payload: { quantity: "9" },
});
check(res.status === 400, "PATCH rejects numeric strings");
res = await call("PATCH", `/breeding/${cropEntry.id}`, {
  token: SWITCH_TOKEN,
  payload: { unknown: 1 },
});
check(res.status === 400, "PATCH rejects unknown fields");
res = await call("PATCH", `/breeding/${cropEntry.id}`, { token: VIEW_TOKEN, payload: { notes: "x" } });
check(res.status === 403, "view-only user cannot patch");

// --- parent rules ------------------------------------------------------------
const sheep = {
  kind: "animal",
  name: "Molly",
  species: "sheep",
  serverLabel: SERVER,
  location: "Sheep pen",
  sex: "female",
  quantity: 1,
};
const farCow = {
  kind: "animal",
  name: "Elsewhere",
  species: "cow",
  serverLabel: "EU Main - weekly",
  location: "Other wipe barn",
  sex: "female",
  quantity: 1,
};
res = await call("POST", "/breeding", { token: SWITCH_TOKEN, payload: sheep });
check(res.status === 201, "sheep created");
const sheepEntry = res.body;
res = await call("POST", "/breeding", { token: SWITCH_TOKEN, payload: farCow });
check(res.status === 201, "other-wipe cow created");
const farCowEntry = res.body;

const calf = {
  kind: "animal",
  name: "Calf",
  species: "cow",
  serverLabel: SERVER,
  location: "Large barn",
  sex: "female",
  motherId: motherEntry.id,
  fatherId: fatherEntry.id,
};
res = await call("POST", "/breeding", { token: SWITCH_TOKEN, payload: calf });
check(res.status === 201, "calf with valid parents created");
const calfEntry = res.body;
check(calfEntry.traits === "" && calfEntry.potential === "", "no animal traits are inferred");

res = await call("POST", "/breeding", {
  token: SWITCH_TOKEN,
  payload: { ...calf, name: "Cross-species", motherId: sheepEntry.id, fatherId: null },
});
check(res.status === 400, "parent must be the same species");
res = await call("POST", "/breeding", {
  token: SWITCH_TOKEN,
  payload: { ...calf, name: "Cross-server", motherId: farCowEntry.id, fatherId: null },
});
check(res.status === 400, "parent must be on the same serverLabel");
res = await call("POST", "/breeding", {
  token: SWITCH_TOKEN,
  payload: { ...calf, name: "Self", motherId: "missing-id", fatherId: null },
});
check(res.status === 400, "missing parent is rejected");
res = await call("POST", "/breeding", {
  token: SWITCH_TOKEN,
  payload: { ...calf, name: "Same parent", motherId: motherEntry.id, fatherId: motherEntry.id },
});
check(res.status === 400, "mother and father must differ");
res = await call("PATCH", `/breeding/${calfEntry.id}`, {
  token: SWITCH_TOKEN,
  payload: { motherId: fatherEntry.id },
});
check(res.status === 400, "mother must be female or unknown");
res = await call("PATCH", `/breeding/${motherEntry.id}`, {
  token: SWITCH_TOKEN,
  payload: { motherId: motherEntry.id },
});
check(res.status === 400, "an entry cannot be its own parent");
res = await call("PATCH", `/breeding/${motherEntry.id}`, {
  token: SWITCH_TOKEN,
  payload: { motherId: calfEntry.id },
});
check(res.status === 400, "cyclic parent references are rejected");
res = await call("PATCH", `/breeding/${cropEntry.id}`, {
  token: SWITCH_TOKEN,
  payload: { motherId: motherEntry.id },
});
check(res.status === 400, "crop entries do not take animal parent references");

// --- concurrent parent race --------------------------------------------------
const raceBase = {
  kind: "animal",
  name: "Race",
  species: "cow",
  serverLabel: SERVER,
  location: "Race barn",
  sex: "unknown",
  quantity: 1,
};
res = await call("POST", "/breeding", { token: SWITCH_TOKEN, payload: { ...raceBase, name: "Race A" } });
check(res.status === 201, "race entry A created");
const raceA = res.body;
res = await call("POST", "/breeding", { token: SWITCH_TOKEN, payload: { ...raceBase, name: "Race B" } });
check(res.status === 201, "race entry B created");
const raceB = res.body;

const raceResults = await Promise.all([
  call("PATCH", `/breeding/${raceA.id}`, { token: SWITCH_TOKEN, payload: { motherId: raceB.id } }),
  call("PATCH", `/breeding/${raceB.id}`, { token: SWITCH_TOKEN, payload: { motherId: raceA.id } }),
]);
const raceStatuses = raceResults.map((result) => result.status).sort((a, b) => a - b);
check(
  raceStatuses[0] === 200 && raceStatuses[1] === 400,
  `concurrent parent cycle: one 200 and one 400 (got ${raceStatuses.join(",")})`,
);
const racePool = (await call("GET", "/breeding", { token: VIEW_TOKEN })).body.entries;
const finalRaceA = racePool.find((entry) => entry.id === raceA.id);
const finalRaceB = racePool.find((entry) => entry.id === raceB.id);
check(Boolean(finalRaceA && finalRaceB), "race entries still present");
check(!(finalRaceA?.motherId && finalRaceB?.motherId), "concurrent updates left no parent cycle");

// --- offspring reference guards ---------------------------------------------
res = await call("PATCH", `/breeding/${motherEntry.id}`, {
  token: SWITCH_TOKEN,
  payload: { species: "sheep" },
});
check(res.status === 409, "cannot change species while referenced by offspring");
res = await call("PATCH", `/breeding/${motherEntry.id}`, {
  token: SWITCH_TOKEN,
  payload: { sex: "male" },
});
check(res.status === 409, "cannot change sex while referenced by offspring");
res = await call("PATCH", `/breeding/${motherEntry.id}`, {
  token: SWITCH_TOKEN,
  payload: { notes: "Still the mother" },
});
check(res.status === 200, "non-reference updates still allowed on a parent");

// --- deletion keeps offspring ------------------------------------------------
res = await call("DELETE", `/breeding/${motherEntry.id}`, { token: SWITCH_TOKEN });
check(res.status === 200 && res.body.ok === true, "delete returns {ok:true}");
res = await call("GET", "/breeding", { token: VIEW_TOKEN });
const afterDelete = res.body.entries;
const calfAfter = afterDelete.find((entry) => entry.id === calfEntry.id);
check(Boolean(calfAfter), "offspring survives parent deletion");
check(calfAfter.motherId === null, "deleted parent reference is nulled");
check(calfAfter.fatherId === fatherEntry.id, "unrelated parent reference is kept");
res = await call("DELETE", `/breeding/${motherEntry.id}`, { token: SWITCH_TOKEN });
check(res.status === 404, "second delete is 404");
res = await call("PATCH", `/breeding/${motherEntry.id}`, { token: SWITCH_TOKEN, payload: { notes: "x" } });
check(res.status === 404, "patch of a deleted entry is 404");

// --- persistence across connections -----------------------------------------
await app.close();
const before = afterDelete.length;
const closeClient = () => {
  const client = db.$client;
  if (client && typeof client.close === "function") client.close();
};
closeClient();

const db2 = createDatabase(dbUrl);
const reopened = await db2.select().from(dbModule.breedingEntries);
check(reopened.length === before, "entries survive reopening the database");
const app2 = Fastify();
await app2.register(cookie, { secret: process.env.SESSION_SECRET });
await registerBreedingRoutes(app2, { db: db2 });
await registerAdminRoutes(app2, { db: db2, rustPlus: {} });
await app2.ready();
const persisted = await app2.inject({
  method: "GET",
  url: "/breeding",
  headers: { cookie: `rusttools_refresh=${VIEW_TOKEN}` },
});
check(persisted.statusCode === 200, "reopened database still serves the pool");
check(JSON.parse(persisted.body).entries.length === before, "reopened pool has the same entries");

// --- admin bulk reset via the existing data-reset framework ------------------
const poolBeforeReset = await db2.select().from(dbModule.breedingEntries);
check(
  poolBeforeReset.some((row) => row.motherId || row.fatherId),
  "pool has a parent-linked child before reset",
);
await db2.insert(dbModule.teamBoardGlobalEntries).values({
  id: "reset-marker",
  kind: "note",
  title: "Keep me",
  content: "unrelated data",
  category: "",
  pinned: false,
  createdBy: "Viewer",
  createdAt: now,
  updatedAt: now,
});

const resetPayload = { scope: "farming_pool" };
let resetRes = await injectCall(app2, "POST", "/admin/data-reset", { payload: resetPayload });
check(resetRes.status === 401, "anonymous reset is denied");
resetRes = await injectCall(app2, "POST", "/admin/data-reset", {
  token: VIEW_TOKEN,
  payload: resetPayload,
});
check(resetRes.status === 403, "view-only reset is denied");
resetRes = await injectCall(app2, "POST", "/admin/data-reset", {
  token: SWITCH_TOKEN,
  payload: resetPayload,
});
check(resetRes.status === 403, "switch reset is denied");
const poolAfterDenials = await db2.select().from(dbModule.breedingEntries);
check(poolAfterDenials.length === before, "denied resets leave the pool untouched");

resetRes = await injectCall(app2, "POST", "/admin/data-reset", {
  token: ADMIN_TOKEN,
  payload: resetPayload,
});
check(resetRes.status === 200 && resetRes.body.ok === true, "admin reset succeeds");
check(resetRes.body.scope === "farming_pool", "reset echoes the farming_pool scope");
check(
  String(resetRes.body.detail).includes(`${before} crop/animal`),
  "reset detail reports the cleared row count",
);
const poolAfter = await db2.select().from(dbModule.breedingEntries);
check(poolAfter.length === 0, "farming pool is empty after reset");
const boardsAfter = await db2.select().from(dbModule.teamBoardGlobalEntries);
check(
  boardsAfter.some((row) => row.id === "reset-marker"),
  "unrelated app data is retained",
);
const audits = await db2.select().from(dbModule.auditEvents);
const resetAudit = audits.find(
  (row) => row.action === "data_reset" && row.targetId === "farming_pool",
);
check(Boolean(resetAudit), "successful reset is audited");
check(resetAudit?.userId === "user-admin-user", "audit records the admin user");

resetRes = await injectCall(app2, "POST", "/admin/data-reset", {
  token: ADMIN_TOKEN,
  payload: resetPayload,
});
check(
  resetRes.status === 200 && String(resetRes.body.detail).includes("0 crop/animal"),
  "repeated reset on an empty pool is safe",
);
await app2.close();
const client2 = db2.$client;
if (client2 && typeof client2.close === "function") client2.close();

try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows may hold the sqlite handle until process exit; the temp dir is disposable.
}
console.log(`breeding API check passed (${checks} assertions)`);


