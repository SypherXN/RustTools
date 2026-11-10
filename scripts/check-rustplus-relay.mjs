import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";

// Offline check: replace `ws` before loading the client so no socket leaves.
const require = createRequire(import.meta.url);
const sockets = [];
class FakeWebSocket extends EventEmitter {
  constructor(address, protocols, options) {
    super();
    this.address = address;
    this.protocols = protocols;
    this.options = options;
    this.argumentCount = arguments.length;
    sockets.push(this);
    queueMicrotask(() => this.emit("open"));
  }
  terminate() {}
}
const wsPath = require.resolve("ws");
require.cache[wsPath] = {
  id: wsPath,
  filename: wsPath,
  loaded: true,
  exports: FakeWebSocket,
  children: [],
  paths: [],
};
const RustPlus = require(require.resolve("@liamcottle/rustplus.js"));

const GUID = "123e4567-e89b-42d3-a456-426614174000";
const TOKEN = "synthetic-companion-token-9f2c";
const STEAM = "76561198000000001";
const ENCODED = Buffer.from(TOKEN, "utf8").toString("base64url");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, label) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 5000) throw new Error(`timeout: ${label}`);
    await delay(5);
  }
}
const relay = (companion) => new RustPlus("", 0, STEAM, "123", false, companion);
async function connectError(client) {
  let error = null;
  client.once("error", (err) => (error = err));
  client.connect();
  await delay(50);
  return error;
}

sockets.length = 0;
relay({ serverId: GUID.toUpperCase(), authToken: TOKEN }).connect();
await waitFor(() => sockets.length === 1, "relay");
const rs = sockets[0];
assert.equal(rs.address, `wss://companion-rust.facepunch.com/socket/${GUID}`);
assert.deepEqual(rs.protocols, ["rustplus.auth.v1", ENCODED]);
assert.deepEqual(rs.options, { followRedirects: false });
assert.equal(rs.argumentCount, 3);
assert.ok(!rs.address.includes("?") && !rs.address.includes(TOKEN));
assert.ok(!JSON.stringify(rs.options).includes(TOKEN));
assert.equal(rs.options.headers, undefined);

sockets.length = 0;
new RustPlus("127.0.0.1", 28082, STEAM, "123").connect();
await waitFor(() => sockets.length === 1, "legacy");
assert.equal(sockets[0].address, "ws://127.0.0.1:28082");
assert.equal(sockets[0].argumentCount, 1);
assert.equal(sockets[0].protocols, undefined);
assert.equal(sockets[0].options, undefined);

for (const serverId of ["not-a-guid", "00000000-0000-0000-0000-000000000000"]) {
  const before = sockets.length;
  const error = await connectError(relay({ serverId, authToken: TOKEN }));
  assert.ok(error instanceof Error);
  assert.ok(!error.message.includes(TOKEN));
  assert.ok(!error.message.includes(serverId));
  assert.ok(!error.message.includes("companion-rust.facepunch.com"));
  assert.equal(sockets.length, before);
}

let sdk = null;
try {
  sdk = await import(new URL("../packages/rustplus-client/dist/index.js", import.meta.url));
} catch {
  sdk = null;
}
const ready =
  typeof sdk?.createRustPlusClient === "function" &&
  typeof sdk?.validateFcmConfigPayload === "function" &&
  typeof sdk?.getCompanionAuth === "function" &&
  typeof sdk?.computeCompanionAuthStatus === "function" &&
  typeof sdk?.parseFcmData === "function";
if (!ready) {
  console.error(
    "rustplus relay check requires a fresh shared/client build: run npm run build --workspace=@rusttools/shared && npm run build --workspace=@rusttools/rustplus-client",
  );
  process.exit(1);
}
const now = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const auth = () => ({
  authToken: TOKEN,
  steamId: STEAM,
  issuedAt: new Date(now - HOUR).toISOString(),
  expiresAt: new Date(now + 2 * DAY).toISOString(),
});
const expired = () => ({
  ...auth(),
  issuedAt: new Date(now - 2 * DAY).toISOString(),
  expiresAt: new Date(now - HOUR).toISOString(),
});
const config = (companion = auth()) => ({
  fcm_credentials: { gcm: { androidId: "12345678901234567890", securityToken: "1234567890123456789" } },
  companion,
});
const hidden = (error, label) => {
  assert.ok(error instanceof Error, label);
  for (const secret of [TOKEN, GUID, "companion-rust.facepunch.com"]) {
    assert.ok(!error.message.includes(secret), label);
  }
};

const valid = sdk.validateFcmConfigPayload(config());
assert.equal(valid.ok, true);
assert.equal(valid.config.fcm_credentials.gcm.androidId, "12345678901234567890");
assert.deepEqual(
  [valid.config.companion.issuedAt, valid.config.companion.expiresAt],
  [auth().issuedAt, auth().expiresAt],
);
for (const candidate of [
  null, [], { fcm_credentials: null }, { fcm_credentials: { gcm: null } },
  { fcm_credentials: { gcm: { androidId: "0123", securityToken: "1" } } },
  { fcm_credentials: { gcm: { androidId: "18446744073709551616", securityToken: "1" } } },
  { fcm_credentials: { gcm: { androidId: 9007199254740993, securityToken: 1 } } },
  { fcm_credentials: { gcm: { androidId: 0, securityToken: 1 } } },
  { fcm_credentials: { gcm: { androidId: "1", securityToken: "1" } }, companion: { ...auth(), authToken: "short" } },
  { fcm_credentials: { gcm: { androidId: "1", securityToken: "1" } }, companion: { ...auth(), steamId: "123" } },
  { fcm_credentials: { gcm: { androidId: "1", securityToken: "1" } }, companion: { ...auth(), issuedAt: new Date(now + DAY).toISOString() } },
]) assert.equal(sdk.validateFcmConfigPayload(candidate).ok, false);

const expiredConfig = config(expired());
const expiredValidated = sdk.validateFcmConfigPayload(expiredConfig);
assert.equal(expiredValidated.ok, true);
assert.equal(expiredValidated.config.companion.expiresAt, expired().expiresAt);
assert.throws(() => sdk.getCompanionAuth(expiredConfig), /expired/i);
assert.throws(() => sdk.getCompanionAuth({ fcm_credentials: { gcm: {} } }), /No companion/i);
assert.throws(() => sdk.getCompanionAuth(config(), "76561198000000002"), /match/i);
assert.equal(sdk.getCompanionAuth(config()).steamId, STEAM);
const status = sdk.computeCompanionAuthStatus(config());
assert.equal(status.configured, true);
assert.equal(status.expired, false);
assert.ok(status.daysRemaining > 0);
assert.ok(!("authToken" in status) && !JSON.stringify(status).includes(TOKEN));
assert.equal(sdk.computeCompanionAuthStatus(expiredConfig).expired, true);
assert.equal(sdk.computeCompanionAuthStatus(expiredConfig).warning, true);

for (const bad of [
  { appData: [{ key: "channelId", value: "x" }, { key: "body", value: "[]" }] },
  { appData: [{ key: "channelId", value: "x" }, { key: "body", value: "null" }] },
  { appData: [{ key: "body", value: "{}" }] },
]) assert.equal(sdk.parseFcmData(bad), null);

const manager = new sdk.RustPlusManager();
class FakeClient extends EventEmitter {
  connect() {}
  disconnect() {}
}
const fakeClient = new FakeClient();
await assert.rejects(manager.waitForConnection(fakeClient, 5), /timed out/);
fakeClient.emit("error", new Error("late handshake error"));

const beforeFactory = sockets.length;
const credentials = (overrides = {}) => ({
  ip: "", port: 0, playerId: STEAM, playerToken: "123",
  companionServerId: GUID, companionAuth: auth(), ...overrides,
});
for (const [raw, expected] of [
  ["-2147483648", -2147483648],
  ["-1", -1],
  ["0", 0],
  ["2147483647", 2147483647],
]) {
  assert.equal(sdk.createRustPlusClient(credentials({ playerToken: raw })).playerToken, expected);
}
for (const [label, creds, pattern] of [
  ["missing", credentials({ companionAuth: undefined }), /No companion Rust\+ auth is configured/i],
  ["expired", credentials({ companionAuth: expired() }), /expired/i],
  ["short auth token", credentials({ companionAuth: { ...auth(), authToken: "short" } }), /token/i],
  ["wrong steam", credentials({ companionAuth: { ...auth(), steamId: "76561198000000002" } }), /match/i],
  ["bad player id", credentials({ playerId: "abc" }), /player id/i],
  ["partial token", credentials({ playerToken: "123x" }), /token/i],
  ["plus token", credentials({ playerToken: "+1" }), /signed/i],
  ["empty token", credentials({ playerToken: "" }), /signed/i],
  ["decimal token", credentials({ playerToken: "1.5" }), /signed/i],
  ["sign only token", credentials({ playerToken: "-" }), /signed/i],
  ["below int32", credentials({ playerToken: "-2147483649" }), /range/i],
  ["above int32", credentials({ playerToken: "2147483648" }), /range/i],
  ["zero guid", credentials({ companionServerId: "00000000-0000-0000-0000-000000000000" }), /server id/i],
]) {
  assert.throws(() => sdk.createRustPlusClient(creds), (error) => {
    hidden(error, label);
    assert.match(error.message, pattern);
    return true;
  }, label);
}
assert.equal(sockets.length, beforeFactory);
const client = sdk.createRustPlusClient(credentials());
assert.equal(client.companion.serverId, GUID);
assert.throws(() => sdk.createRustPlusClient({ ...credentials(), companionServerId: null, ip: "" }), /legacy/i);
assert.throws(() => sdk.createRustPlusClient({ ...credentials(), companionServerId: null, ip: "127.0.0.1", port: 70000 }), /port/i);
console.log("rustplus relay checks passed");
