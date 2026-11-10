// Focused API check for Rust+ companion relay pairing.
// Run after `npm run build`:
//   node scripts/check-rustplus-pairing.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDist = path.join(repoRoot, "apps/api/dist");
const requiredDist = [
  "services/fcm-handler.js",
  "services/rustplus-bootstrap.js",
  "lib/fcm-credentials.js",
  "lib/crypto.js",
  "lib/promote-leader.js",
  "routes/servers.js",
];
for (const rel of requiredDist) {
  if (!fs.existsSync(path.join(apiDist, rel))) {
    console.error(`Missing ${rel} — run \`npm run build\` before this check.`);
    process.exit(1);
  }
}

process.env.NODE_ENV = "development";
process.env.DISCORD_GUILD_ID = "check-guild";
process.env.DISCORD_BOT_TOKEN = "check-bot-token";
process.env.DISCORD_ROLE_ADMIN = "role-admin";
process.env.DISCORD_ROLE_SWITCH = "role-switch";
process.env.DISCORD_ROLE_VIEW = "role-view";
process.env.SESSION_SECRET = "check-session-secret";
process.env.ENCRYPTION_KEY = "check-encryption-key";

const roleAssignments = new Map([
  ["view-user", ["role-view"]],
  ["admin-user", ["role-admin"]],
]);
globalThis.fetch = async (url) => {
  const match = String(url).match(/\/guilds\/[^/]+\/members\/([^/]+)$/);
  if (!match) throw new Error(`Unexpected fetch in pairing check: ${url}`);
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
  preferredTempRoot && fs.existsSync(preferredTempRoot) ? preferredTempRoot : os.tmpdir();
const dir = fs.mkdtempSync(path.join(tempRoot, "rustplus-pairing-check-"));

const drizzleDir = path.join(repoRoot, "packages/db/drizzle");
const journal = JSON.parse(
  fs.readFileSync(path.join(drizzleDir, "meta/_journal.json"), "utf8"),
);
function migrationSql(tag) {
  return fs
    .readFileSync(path.join(drizzleDir, `${tag}.sql`), "utf8")
    .replaceAll("--> statement-breakpoint", ";");
}

// --- 1. Real migration preserves an existing server + child -----------------
const BetterSqlite3 = (await import("better-sqlite3")).default;
const preDbPath = path.join(dir, "pre-migration.db");
{
  const sqlite = new BetterSqlite3(preDbPath);
  sqlite.pragma("foreign_keys = ON");
  for (const entry of journal.entries) {
    if (entry.tag === "0025_companion_server_id") continue;
    sqlite.exec(migrationSql(entry.tag));
  }
  const nowIso = Math.floor(Date.now() / 1000);
  sqlite
    .prepare(
      "INSERT INTO fcm_credentials (id, label, config_encrypted, registered_at, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run("fcm-legacy-slot", "Legacy", "{}", nowIso, 1, nowIso, nowIso);
  sqlite
    .prepare(
      "INSERT INTO rust_servers (id, fcm_credential_id, name, ip, port, player_id, player_token_encrypted, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .run("server-before", "fcm-legacy-slot", "Existing", "10.0.0.9", 28082, "76561198000000009", "enc", 1, nowIso, nowIso);
  sqlite
    .prepare(
      "INSERT INTO rust_entities (id, server_id, entity_id, entity_type, name, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run("entity-before", "server-before", 42, "smart_switch", "Child", nowIso, nowIso);

  sqlite.exec(migrationSql("0025_companion_server_id"));

  const server = sqlite.prepare("SELECT * FROM rust_servers WHERE id = 'server-before'").get();
  const child = sqlite.prepare("SELECT * FROM rust_entities WHERE id = 'entity-before'").get();
  check(Boolean(server), "migration keeps the existing server row");
  check(server.name === "Existing" && server.ip === "10.0.0.9", "server fields preserved");
  check(server.companion_server_id === null, "new companion column defaults to null");
  check(Boolean(child) && child.server_id === "server-before", "child row and FK preserved");
  sqlite.close();
}

// --- 2. Migration runner applies the journal (and is idempotent) ------------
const dbModule = await import("@rusttools/db");
const { createDatabase, runMigrations, fcmCredentials, rustEntities, rustServers, sessions, users } =
  dbModule;
const dbUrl = `file:${path.join(dir, "pairing.db")}`;
runMigrations(dbUrl);
runMigrations(dbUrl);
const db = createDatabase(dbUrl);
const columns = db.$client
  .prepare("PRAGMA table_info(rust_servers)")
  .all()
  .map((row) => row.name);
check(columns.includes("companion_server_id"), "runMigrations applies 0025_companion_server_id");

// --- 3. Pairing through the FCM handler -------------------------------------
const apiImport = (rel) => import(pathToFileURL(path.join(apiDist, rel)).href);
const { handleFcmNotification } = await apiImport("services/fcm-handler.js");
const { reconnectRustServer } = await apiImport("services/rustplus-bootstrap.js");
const {
  createFcmCredential,
  getActiveFcmCredentialStatus,
  listFcmCredentialSummaries,
  replaceFcmCredentialConfig,
} = await apiImport("lib/fcm-credentials.js");
const { encrypt } = await apiImport("lib/crypto.js");
const { canPromoteViaRustPlus } = await apiImport("lib/promote-leader.js");
const { registerServerRoutes } = await apiImport("routes/servers.js");
const { eq } = await import("drizzle-orm");

// Match the database's integer-second timestamp precision.
const NOW = Math.floor(Date.now() / 1000) * 1000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const GUID_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const GUID_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const GUID_C = "cccccccc-3333-4333-8333-cccccccccccc";
const GUID_D = "dddddddd-4444-4444-8444-dddddddddddd";
const GUID_E = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";
const STEAM_MASTER = "76561198000000001";
const STEAM_C = "76561198000000003";
const STEAM_D = "76561198000000004";
const STEAM_LEGACY = "76561198000000005";
const GCM = { androidId: "10000000000000000001", securityToken: "2000000000000000001" };

function companionAuth(steamId, { expired = false, token = "synthetic-companion-token" } = {}) {
  return {
    authToken: token,
    steamId,
    issuedAt: new Date(expired ? NOW - 2 * DAY : NOW - HOUR).toISOString(),
    expiresAt: new Date(expired ? NOW - HOUR : NOW + 2 * DAY).toISOString(),
  };
}
function fcmConfig({ companion, gcm = GCM } = {}) {
  return {
    fcm_credentials: { gcm: { ...gcm } },
    ...(companion ? { companion } : {}),
  };
}

await db.insert(fcmCredentials).values({
  id: "fcm-active",
  label: "Active relay slot",
  configEncrypted: encrypt(JSON.stringify(fcmConfig({ companion: companionAuth(STEAM_MASTER) }))),
  registeredAt: new Date(NOW - 2 * DAY),
  isActive: true,
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
});

const calls = { connect: [], disconnect: [], reload: 0, subscribe: [] };
const connections = new Map();
let activeServerId = null;
const rustPlus = {
  async connectServer(credentials) {
    const stored = {
      ...credentials,
      companionAuth: credentials.companionAuth ? { ...credentials.companionAuth } : undefined,
    };
    calls.connect.push(stored);
    connections.set(credentials.id, stored);
  },
  async disconnectServer(id, opts) {
    calls.disconnect.push({ id, opts });
    connections.delete(id);
    if (activeServerId === id) {
      activeServerId = connections.keys().next().value ?? null;
    }
  },
  setActiveServer(id) {
    activeServerId = id;
  },
  handleServerPaired() {},
  handleEntityPaired() {},
  async reloadFcmListener() {
    calls.reload += 1;
  },
  stopFcmListener() {},
  async unsubscribeCamera() {},
  getStatus() {
    return { activeServerId, fcmListening: true };
  },
  async getServerInfo() {
    return {};
  },
  async subscribeEntity(id) {
    calls.subscribe.push(id);
  },
};
async function pair(payload) {
  await handleFcmNotification(
    db,
    rustPlus,
    { channelId: "pairing", body: payload, title: "", message: "" },
    {},
  );
}
async function serversFor(guid) {
  return db.select().from(rustServers).where(eq(rustServers.companionServerId, guid));
}

await db.insert(users).values({
  id: "view-user-id",
  discordId: "view-user",
  discordUsername: "Viewer",
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
});
await db.insert(users).values({
  id: "admin-user-id",
  discordId: "admin-user",
  discordUsername: "Admin",
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
});
const VIEW_TOKEN = "check-view-token";
const ADMIN_TOKEN = "check-admin-token";
await db.insert(sessions).values([
  {
    id: "view-session",
    userId: "view-user-id",
    refreshTokenHash: createHash("sha256").update(VIEW_TOKEN).digest("hex"),
    expiresAt: new Date(NOW + HOUR),
    createdAt: new Date(NOW),
  },
  {
    id: "admin-session",
    userId: "admin-user-id",
    refreshTokenHash: createHash("sha256").update(ADMIN_TOKEN).digest("hex"),
    expiresAt: new Date(NOW + HOUR),
    createdAt: new Date(NOW),
  },
]);

const Fastify = (await import("fastify")).default;
const cookie = (await import("@fastify/cookie")).default;
const app = Fastify();
await app.register(cookie, { secret: process.env.SESSION_SECRET });
await registerServerRoutes(app, { db, rustPlus });
await app.ready();

await pair({
  type: "server",
  id: GUID_A,
  name: "Relay A",
  playerId: STEAM_MASTER,
  playerToken: "111111",
});
check(calls.connect.length === 1, "modern pairing connects once");
let [serverA] = await serversFor(GUID_A);
check(Boolean(serverA), "modern UUID pairing creates a server");
check(serverA.companionServerId === GUID_A, "companion UUID stored");
check(serverA.ip === "" && serverA.port === 0, "relay row uses ''/0 sentinel");
check(serverA.isActive === true, "first relay server is active");
check(
  calls.connect[0].companionServerId === GUID_A &&
    calls.connect[0].companionAuth?.steamId === STEAM_MASTER,
  "connect receives UUID + matching companion auth",
);
check(
  calls.connect[0].ip === "" && calls.connect[0].port === 0,
  "connect never treats sentinels as an endpoint",
);
const serverAId = serverA.id;
check(
  connections.has(serverAId) && activeServerId === serverAId,
  "runtime follows the newly paired relay server",
);

await pair({
  type: "entity",
  id: GUID_A,
  entityId: 9001,
  entityName: "Storage Monitor",
  playerId: STEAM_MASTER,
});
const [entityA] = await db.select().from(rustEntities).where(eq(rustEntities.entityId, 9001));
check(Boolean(entityA) && entityA.serverId === serverAId, "entity pairs by slot + UUID");
check(calls.subscribe.includes(9001), "active relay server resubscribes the entity");

await pair({
  type: "server",
  id: GUID_B,
  name: "Relay B",
  playerId: STEAM_MASTER,
  playerToken: "444444",
});
let relayServers = await db.select().from(rustServers).where(eq(rustServers.fcmCredentialId, "fcm-active"));
check(relayServers.length === 2, "two UUID-only servers stay distinct");
check(new Set(relayServers.map((row) => row.id)).size === 2, "distinct primary keys");
check(relayServers.filter((row) => row.isActive).length === 1, "only one slot server is active");
const serverBId = relayServers.find((row) => row.companionServerId === GUID_B).id;
check(
  connections.has(serverBId) && !connections.has(serverAId),
  "switching servers disconnects the previously active runtime connection",
);

await pair({
  type: "server",
  id: GUID_A,
  name: "Relay A renamed",
  playerId: STEAM_MASTER,
  playerToken: "222222",
});
[serverA] = await serversFor(GUID_A);
check(serverA.id === serverAId, "same-UUID re-pair updates in place (PK preserved)");
check(serverA.name === "Relay A renamed", "re-pair updates the label");
check(calls.connect.at(-1).playerToken === "222222", "re-pair stores the fresh player token");
check(
  connections.has(serverAId) && !connections.has(serverBId),
  "in-place re-pair refreshes runtime secrets for the same id",
);
const [entityAfterRepair] = await db
  .select()
  .from(rustEntities)
  .where(eq(rustEntities.entityId, 9001));
check(entityAfterRepair.serverId === serverAId, "re-pair keeps paired entities");

// Invalid/missing identifiers must not consume a pending master link.
await db.insert(users).values({
  id: "pending-master",
  discordId: "pending-master",
  discordUsername: "Pending",
  pendingLinkType: "master",
  pendingRustLink: true,
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
});
const rowsBeforeInvalid = (await db.select().from(rustServers)).length;
await pair({ type: "server", id: "not-a-guid", playerId: STEAM_MASTER, playerToken: "333333" });
await pair({ type: "server", playerId: STEAM_MASTER, playerToken: "333333" });
await pair({ type: "server", id: GUID_C });
await pair({ type: "server", id: GUID_D, playerId: "not-numeric", playerToken: "abc" });
await pair({ type: "server", id: GUID_D, playerId: STEAM_MASTER, playerToken: "abc" });
const [pending] = await db.select().from(users).where(eq(users.id, "pending-master"));
check(pending.pendingLinkType === "master", "invalid modern pairing leaves pending master untaken");
check(
  (await db.select().from(rustServers)).length === rowsBeforeInvalid,
  "invalid modern pairing writes no server",
);
check((await serversFor(GUID_D)).length === 0, "malformed player credentials never persist a pair");

// Signed int32 token boundary: overflow stays pending with no row; negatives work.
for (const token of ["2147483648", "-2147483649"]) {
  await pair({ type: "server", id: GUID_D, playerId: STEAM_MASTER, playerToken: token });
}
await pair({ type: "server", id: GUID_D, playerId: "765611980", playerToken: "1" });
const [pendingAfterOverflow] = await db
  .select()
  .from(users)
  .where(eq(users.id, "pending-master"));
check(
  pendingAfterOverflow.pendingLinkType === "master",
  "overflow token and short relay player id leave pending master untaken",
);
check(
  (await db.select().from(rustServers)).length === rowsBeforeInvalid &&
    (await serversFor(GUID_D)).length === 0,
  "overflow token and short relay player id never persist a row",
);

await pair({
  type: "server",
  id: GUID_E,
  name: "Relay E",
  playerId: STEAM_MASTER,
  playerToken: "-1234567890",
});
const [serverE] = await serversFor(GUID_E);
check(Boolean(serverE) && serverE.isActive === true, "negative int32 token pairs normally");
check(
  calls.connect.at(-1).playerToken === "-1234567890",
  "negative token reaches the connection unchanged",
);
const [pendingAfterValid] = await db
  .select()
  .from(users)
  .where(eq(users.id, "pending-master"));
check(
  pendingAfterValid.pendingLinkType === null,
  "valid signed-token pairing still consumes the pending master link",
);

// --- 4. Missing / expired companion auth keeps the pair ---------------------
await db
  .update(fcmCredentials)
  .set({ isActive: false })
  .where(eq(fcmCredentials.isActive, true));
const noAuthRegisteredAt = new Date(NOW - 10 * DAY);
await db.insert(fcmCredentials).values({
  id: "fcm-noauth",
  label: "Relay without companion auth",
  configEncrypted: encrypt(JSON.stringify(fcmConfig())),
  registeredAt: noAuthRegisteredAt,
  isActive: true,
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
});

const connectsBeforeNoAuth = calls.connect.length;
await pair({
  type: "server",
  id: GUID_C,
  name: "Relay C",
  playerId: STEAM_C,
  playerToken: "666666",
});
const [serverC] = await serversFor(GUID_C);
check(Boolean(serverC), "pair persists even when relay auth is missing");
check(serverC.isActive === true, "pair without auth still becomes the active server");
check(calls.connect.length === connectsBeforeNoAuth, "missing auth never dials anything");
check(
  !connections.has(serverAId) && connections.size === 0,
  "missing-auth pairing disconnects the previous runtime server",
);
check(activeServerId !== serverAId, "runtime does not keep serving the old server");
const serverCId = serverC.id;

const failedActivate = await app.inject({
  method: "POST",
  url: `/servers/${serverCId}/activate`,
  headers: { cookie: `rusttools_refresh=${ADMIN_TOKEN}` },
});
check(failedActivate.statusCode === 502, "activate without companion auth fails clearly");
const [serverCAfterActivate] = await db
  .select()
  .from(rustServers)
  .where(eq(rustServers.id, serverCId));
check(serverCAfterActivate.isActive === true, "failed activate keeps the selected DB server active");
check(
  !connections.has(serverCId) && connections.size === 0,
  "failed activate leaves no runtime connection for the selected server",
);
check(!failedActivate.body.includes("companion-token"), "activate error never echoes auth");

const expiredCompanion = companionAuth(STEAM_C, { expired: true });
const expiredSummary = await replaceFcmCredentialConfig(
  db,
  rustPlus,
  "fcm-noauth",
  fcmConfig({ companion: expiredCompanion }),
);
check(
  expiredSummary.registeredAt === noAuthRegisteredAt.toISOString(),
  "same-GCM auth renewal keeps the 90-day clock",
);
check(expiredSummary.companion?.expired === true, "expired companion metadata is still computed");
check(calls.connect.length === connectsBeforeNoAuth, "expired companion auth does not connect");
check(
  (await db.select().from(fcmCredentials).where(eq(fcmCredentials.id, "fcm-noauth"))).length === 1,
  "expired companion auth never purges the FCM slot",
);
check((await serversFor(GUID_C)).length === 1, "expired companion auth keeps paired servers");

// --- 5. Renewal identity checks + stale connection refresh ------------------
const wrongSteam = fcmConfig({ companion: companionAuth(STEAM_D) });
let renewalError = null;
try {
  await replaceFcmCredentialConfig(db, rustPlus, "fcm-noauth", wrongSteam);
} catch (err) {
  renewalError = err;
}
check(
  renewalError instanceof Error && /Steam ID does not match/i.test(renewalError.message),
  "renewal with a different Steam identity is rejected",
);
check(
  !String(renewalError?.message ?? "").includes("companion-token"),
  "renewal rejection never echoes the auth token",
);
const afterWrong = await getActiveFcmCredentialStatus(db, rustPlus);
check(afterWrong.companion?.steamId === STEAM_C, "rejected renewal left the config untouched");

const renewedToken = "synthetic-companion-token-renewed";
const connectsBeforeRenewal = calls.connect.length;
const renewedSummary = await replaceFcmCredentialConfig(
  db,
  rustPlus,
  "fcm-noauth",
  fcmConfig({ companion: companionAuth(STEAM_C, { token: renewedToken }) }),
);
check(calls.connect.length === connectsBeforeRenewal + 1, "renewal reconnects with fresh auth");
check(
  calls.connect.at(-1).companionServerId === GUID_C &&
    calls.connect.at(-1).companionAuth.authToken === renewedToken,
  "reconnect uses the renewed companion auth",
);
check(
  renewedSummary.registeredAt === noAuthRegisteredAt.toISOString(),
  "auth renewal does not extend the 90-day clock",
);
check(renewedSummary.companion?.expired === false, "renewed auth is reported unexpired");
check(
  connections.has(serverCId) && activeServerId === serverCId,
  "runtime follows the renewed selected server",
);

const secondToken = "synthetic-companion-token-renewed-2";
await replaceFcmCredentialConfig(
  db,
  rustPlus,
  "fcm-noauth",
  fcmConfig({ companion: companionAuth(STEAM_C, { token: secondToken }) }),
);
check(
  calls.disconnect.some(
    (entry) => entry.id === serverCId && entry.opts?.dropCredentials === true,
  ),
  "renewal drops the stale connection and its retry client",
);
check(calls.connect.at(-1).companionAuth.authToken === secondToken, "second renewal reconnects fresh");

// GCM-only re-import keeps the companion auth block and its metadata.
const retainedIssuedAt = companionAuth(STEAM_C).issuedAt;
await replaceFcmCredentialConfig(db, rustPlus, "fcm-noauth", fcmConfig());
const afterGcmOnly = await getActiveFcmCredentialStatus(db, rustPlus);
check(afterGcmOnly.companion?.steamId === STEAM_C, "GCM-only renewal preserves companion metadata");
check(
  afterGcmOnly.companion?.issuedAt === retainedIssuedAt,
  "companion auth timestamps survive a GCM-only re-import",
);

// Renewing with expired auth must drop the old runtime connection too.
const connectsBeforeExpiredRenewal = calls.connect.length;
const expiredAgain = await replaceFcmCredentialConfig(
  db,
  rustPlus,
  "fcm-noauth",
  fcmConfig({ companion: companionAuth(STEAM_C, { expired: true }) }),
);
check(expiredAgain.companion?.expired === true, "expired renewal reports expired metadata");
check(
  !connections.has(serverCId) && activeServerId !== serverCId,
  "expired renewal disconnects the old runtime connection",
);
check(
  calls.connect.length === connectsBeforeExpiredRenewal,
  "expired renewal never dials the selected server",
);
const [serverCAfterExpired] = await db
  .select()
  .from(rustServers)
  .where(eq(rustServers.id, serverCId));
check(serverCAfterExpired.isActive === true, "expired renewal keeps the selected DB server active");

// --- 6. Legacy direct pairing is preserved ---------------------------------
const connectsBeforeLegacy = calls.connect.length;
await pair({
  type: "server",
  ip: "198.51.100.7",
  port: 28100,
  name: "Legacy Direct",
  playerId: STEAM_LEGACY,
  playerToken: "555",
});
const [legacy] = await db
  .select()
  .from(rustServers)
  .where(eq(rustServers.ip, "198.51.100.7"));
check(Boolean(legacy) && legacy.companionServerId === null, "legacy pairing keeps ip:port rows");
check(legacy.port === 28100, "legacy port preserved");
check(
  calls.connect.length === connectsBeforeLegacy + 1 &&
    calls.connect.at(-1).ip === "198.51.100.7" &&
    calls.connect.at(-1).port === 28100 &&
    calls.connect.at(-1).companionAuth === undefined,
  "legacy connect still dials ip:port without companion auth",
);

await pair({
  type: "entity",
  ip: "198.51.100.7",
  port: 28100,
  entityId: 9002,
  entityName: "Smart Alarm",
  playerId: STEAM_LEGACY,
});
const [legacyEntity] = await db
  .select()
  .from(rustEntities)
  .where(eq(rustEntities.entityId, 9002));
check(legacyEntity.serverId === legacy.id, "legacy entity pairing still matches ip:port");

const activateOk = await app.inject({
  method: "POST",
  url: `/servers/${legacy.id}/activate`,
  headers: { cookie: `rusttools_refresh=${ADMIN_TOKEN}` },
});
check(activateOk.statusCode === 200, "activate succeeds through the central reconnect helper");
check(
  connections.has(legacy.id) && activeServerId === legacy.id,
  "activate leaves runtime and DB on the selected server",
);

// --- 7. Public surfaces expose status metadata, never secrets ---------------
const serversRes = await app.inject({
  method: "GET",
  url: "/servers",
  headers: { cookie: `rusttools_refresh=${VIEW_TOKEN}` },
});
check(serversRes.statusCode === 200, "GET /servers succeeds for a viewer");
const serverList = JSON.parse(serversRes.body).servers;
check(
  serverList.some((row) => row.id === serverCId && row.companionServerId === GUID_C),
  "GET /servers exposes companionServerId",
);
for (const secretKey of ["authToken", "companionAuth", "playerToken", "securityToken"]) {
  check(!serversRes.body.includes(secretKey), `GET /servers does not expose ${secretKey}`);
}
await app.close();

const status = await getActiveFcmCredentialStatus(db, rustPlus);
const summaries = await listFcmCredentialSummaries(db, rustPlus);
check(status.companion?.steamId === STEAM_C, "credential status exposes companion metadata");
check(
  summaries.some((row) => row.id === "fcm-noauth" && row.companion?.steamId === STEAM_C),
  "credential summary exposes companion metadata",
);
for (const payload of [JSON.stringify(status), JSON.stringify(summaries)]) {
  check(!payload.includes("authToken"), "status/summary never expose authToken");
  check(!payload.includes("companion-token"), "status/summary never expose token values");
}

const claimedRegisteredAt = "2025-01-01T00:00:00.000Z";
const created = await createFcmCredential(
  db,
  rustPlus,
  "Clock check",
  {
    ...fcmConfig({
      gcm: {
        androidId: "3000000000000000001",
        securityToken: "4000000000000000001",
      },
    }),
    registered_at: claimedRegisteredAt,
  },
  { activate: false },
);
check(
  created.registeredAt === claimedRegisteredAt,
  "create honors the uploaded acquisition clock instead of resetting it",
);

// --- 8. Relay gating for companion-account leader promotion -----------------
const activeRelay = {
  id: serverCId,
  playerId: STEAM_C,
  ip: "",
  port: 0,
  companionServerId: GUID_C,
};
check(
  (await canPromoteViaRustPlus(db, activeRelay, STEAM_C)) === true,
  "master account can still promote on a relay server",
);
check(
  (await canPromoteViaRustPlus(db, activeRelay, STEAM_D)) === false,
  "relay servers refuse another Steam identity's companion credentials",
);

const client = db.$client;
if (client && typeof client.close === "function") client.close();
try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows may keep sqlite handles until exit; temp dir is disposable.
}
console.log(`rustplus pairing API check passed (${checks} assertions)`);
