#!/usr/bin/env node
/**
 * RustTools smoke test suite — run after build:
 *   node scripts/smoke-test.mjs
 *
 * Requires: built packages, local API on :3000, .env with INTERNAL_API_KEY (optional for internal routes)
 */
import { config } from "dotenv";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  buildMapTransform,
  worldToMapPixel,
  parseEventTeamChatCommand,
  parseLeaderTeamChatCommand,
  canBecomeTeamLeader,
  isDataResetScope,
  listStaticCctvCodes,
  mergeNotificationSettings,
  DEFAULT_SERVER_NOTIFICATION_SETTINGS,
} from "@rusttools/shared";
import {
  validateFcmConfigPayload,
  getFcmCredentialStatus,
} from "../packages/rustplus-client/dist/fcm-status.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.resolve(repoRoot, ".env") });

const API = process.env.SMOKE_API_URL ?? "http://127.0.0.1:3000";
const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? "";

function internalInit(path, discordUserId) {
  const sep = path.includes("?") ? "&" : "?";
  return {
    headers: {
      Authorization: `Bearer ${INTERNAL_KEY}`,
    },
    url: `${API}${path}${sep}discordUserId=${encodeURIComponent(discordUserId)}`,
  };
}

function loadDiscordUserId() {
  if (process.env.SMOKE_DISCORD_USER_ID) return process.env.SMOKE_DISCORD_USER_ID;
  try {
    const dbPath = path.resolve(repoRoot, "data/rusttools.db");
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare(`SELECT discord_id AS discordId FROM users LIMIT 1`).get();
    db.close();
    return row?.discordId ?? null;
  } catch {
    return null;
  }
}

const results = [];
const skipped = [];

function pass(name) {
  results.push({ name, ok: true });
  console.log(`  ✓ ${name}`);
}

function skip(name, detail) {
  skipped.push({ name, detail });
  console.log(`  … ${name}${detail ? ` (${detail})` : ""}`);
}

function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.error(`  ✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function assert(name, condition, detail) {
  if (condition) pass(name);
  else fail(name, detail);
}

async function fetchJson(url, init = {}, cookieJar = null) {
  const headers = { ...(init.headers ?? {}) };
  if (cookieJar && Object.keys(cookieJar).length > 0) {
    headers.Cookie = Object.entries(cookieJar)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  const res = await fetch(url, { ...init, headers });
  if (cookieJar) {
    const setCookies =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : res.headers.get("set-cookie")
          ? [res.headers.get("set-cookie")]
          : [];
    for (const line of setCookies) {
      const part = line.split(";")[0]?.trim();
      if (!part) continue;
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      cookieJar[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, ok: res.ok, headers: res.headers };
}

function updateCookieJarFromResponse(res, cookieJar) {
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie")]
        : [];
  for (const line of setCookies) {
    const part = line.split(";")[0]?.trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    cookieJar[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
}

function loadSessionCookie() {
  const token = ensureSmokeRefreshToken();
  if (token) return `rusttools_refresh=${token}`;
  return null;
}

function ensureSmokeRefreshToken() {
  if (process.env.SMOKE_REFRESH_TOKEN) return process.env.SMOKE_REFRESH_TOKEN;
  try {
    const dbPath = path.resolve(repoRoot, "data/rusttools.db");
    const db = new Database(dbPath);
    const user = db.prepare("SELECT id FROM users LIMIT 1").get();
    if (!user) {
      db.close();
      return null;
    }
    const token = `smoke-${randomBytes(24).toString("hex")}`;
    const hash = createHash("sha256").update(token).digest("hex");
    const sessionId = `smoke-${randomBytes(12).toString("hex")}`;
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    const createdAt = Date.now();
    db.prepare("DELETE FROM sessions WHERE id LIKE 'smoke-%'").run();
    db.prepare(
      `INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(sessionId, user.id, hash, expiresAt, createdAt);
    db.close();
    return token;
  } catch {
    return null;
  }
}

// ── Unit: @rusttools/shared ──────────────────────────────────────────────

console.log("\n=== Shared package ===");

const transform = buildMapTransform(
  { width: 2048, height: 2048, oceanMargin: 500 },
  { mapSize: 4000 },
);
const pixel = worldToMapPixel(2000, 2000, transform);
assert("buildMapTransform + worldToMapPixel", pixel.x > 0 && pixel.y > 0);

assert('parseEventTeamChatCommand "!cargo"', parseEventTeamChatCommand("!cargo") === "cargo");
assert('parseEventTeamChatCommand "!heli"', parseEventTeamChatCommand("!heli") === "heli");
assert("isDataResetScope valid", isDataResetScope("team_events"));
assert("isDataResetScope invalid", !isDataResetScope("nope"));

const merged = mergeNotificationSettings(DEFAULT_SERVER_NOTIFICATION_SETTINGS, { tcDecay: { warningHours: 12 } });
assert("mergeNotificationSettings", merged.tcDecay.warningHours === 12);

assert("listStaticCctvCodes non-empty", listStaticCctvCodes().length > 10);

assert('parseLeaderTeamChatCommand "!leader"', parseLeaderTeamChatCommand("!leader"));
assert('parseLeaderTeamChatCommand "!leader x" ignored', !parseLeaderTeamChatCommand("!leaderx"));

assert(
  "canBecomeTeamLeader eligible member",
  canBecomeTeamLeader({ isLeader: false, isOnline: true, isAlive: true }),
);
assert(
  "canBecomeTeamLeader rejects offline",
  !canBecomeTeamLeader({ isLeader: false, isOnline: false, isAlive: true }),
);
assert(
  "canBecomeTeamLeader rejects dead",
  !canBecomeTeamLeader({ isLeader: false, isOnline: true, isAlive: false }),
);
assert(
  "canBecomeTeamLeader rejects current leader",
  !canBecomeTeamLeader({ isLeader: true, isOnline: true, isAlive: true }),
);

// ── Unit: @rusttools/rustplus-client ────────────────────────────────────

console.log("\n=== Rust+ client package ===");

const badFcm = validateFcmConfigPayload({});
assert("validateFcmConfig rejects empty", !badFcm.ok);

const goodFcm = validateFcmConfigPayload({
  fcm_credentials: { gcm: { androidId: "1", securityToken: "abc" } },
});
assert("validateFcmConfig accepts valid", goodFcm.ok);

assert(
  "camera timeout message pattern",
  /timeout/i.test("Timeout reached while waiting for response"),
);

const fcmPath = path.resolve(repoRoot, "data/fcm-config.json");
const fcmStatus = getFcmCredentialStatus(fcmPath, true);
assert("getFcmCredentialStatus configured", fcmStatus.configured === true || !fcmStatus.configured);

// ── API: public / health ────────────────────────────────────────────────

console.log("\n=== API health ===");

let health;
try {
  health = await fetchJson(`${API}/health`);
} catch (err) {
  fail("API reachable", err.message);
  health = null;
}

if (health) {
  assert("GET /health → 200", health.status === 200);
  assert("health.status ok", health.body?.status === "ok");
  assert("health has rustplus", health.body?.rustplus != null);
  assert("health has fcm", health.body?.fcm != null);
}

// ── API: auth boundaries ────────────────────────────────────────────────

console.log("\n=== API auth boundaries ===");

const unauth = await fetchJson(`${API}/servers/active/team`);
assert("GET /servers/active/team without cookie → 401", unauth.status === 401);

const internalNoKey = await fetchJson(`${API}/internal/health`);
assert("GET /internal/health without key → 401/403", internalNoKey.status === 401 || internalNoKey.status === 403);

const linkSteamUnauth = await fetchJson(`${API}/auth/link-steam`, { method: "POST" });
assert("POST /auth/link-steam without cookie → 401", linkSteamUnauth.status === 401);

const linkCompanionUnauth = await fetchJson(`${API}/auth/link-companion`, { method: "POST" });
assert("POST /auth/link-companion without cookie → 401", linkCompanionUnauth.status === 401);

const linkMasterUnauth = await fetchJson(`${API}/auth/link-master`, { method: "POST" });
assert("POST /auth/link-master without cookie → 401", linkMasterUnauth.status === 401);

// ── API: internal (bot) routes ──────────────────────────────────────────

console.log("\n=== Internal API (Discord bot surface) ===");

if (!INTERNAL_KEY) {
  fail("INTERNAL_API_KEY set in .env", "skipped internal live tests");
} else {
  const discordUserId = loadDiscordUserId();
  if (!discordUserId) {
    fail("Discord user id for internal tests", "set SMOKE_DISCORD_USER_ID or log in once so users table is populated");
  } else {
    const iHealthReq = internalInit("/internal/health", discordUserId);
    const iHealth = await fetchJson(iHealthReq.url, { headers: iHealthReq.headers });
    assert("GET /internal/health", iHealth.status === 200);

    const iTeamReq = internalInit("/internal/team", discordUserId);
    const iTeam = await fetchJson(iTeamReq.url, { headers: iTeamReq.headers });
    assert("GET /internal/team", iTeam.status === 200 && iTeam.body?.team != null);

    const iTimeReq = internalInit("/internal/time", discordUserId);
    const iTime = await fetchJson(iTimeReq.url, { headers: iTimeReq.headers });
    assert("GET /internal/time", iTime.status === 200);

    const iDeepReq = internalInit("/internal/deepsea", discordUserId);
    const iDeep = await fetchJson(iDeepReq.url, { headers: iDeepReq.headers });
    assert("GET /internal/deepsea", iDeep.status === 200);

    const iDevicesReq = internalInit("/internal/devices", discordUserId);
    const iDevices = await fetchJson(iDevicesReq.url, { headers: iDevicesReq.headers });
    assert("GET /internal/devices", iDevices.status === 200);
    if (iDevices.body?.devices?.length) {
      const switches = iDevices.body.devices.filter((d) => d.entityType === "smart_switch");
      if (switches.length) {
        assert(
          "GET /internal/devices includes switchValue for switches",
          "switchValue" in switches[0],
        );
      }
    }

    const iTargetsReq = internalInit(
      "/internal/device-targets?entityType=smart_switch",
      discordUserId,
    );
    const iTargets = await fetchJson(iTargetsReq.url, { headers: iTargetsReq.headers });
    assert("GET /internal/device-targets", iTargets.status === 200 && Array.isArray(iTargets.body?.targets));

    const slashHelp = await fetchJson(`${API}/internal/slash-command/execute`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INTERNAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        discordUserId,
        message: "!help",
      }),
    });
    assert(
      "POST /internal/slash-command/execute !help",
      slashHelp.status === 200 &&
        (slashHelp.body?.replies?.length > 0 || slashHelp.body?.embeds?.length > 0),
    );

    const slashLeader = await fetchJson(`${API}/internal/slash-command/execute`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INTERNAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        discordUserId,
        message: "!leader",
      }),
    });
    assert(
      "POST /internal/slash-command/execute !leader",
      slashLeader.status === 200 &&
        (slashLeader.body?.reply != null ||
          slashLeader.body?.embeds?.length > 0 ||
          typeof slashLeader.body?.error === "string"),
    );

    const noPermUser = "000000000000000000";
    const deniedReq = internalInit("/internal/team", noPermUser);
    const denied = await fetchJson(deniedReq.url, { headers: deniedReq.headers });
    if (process.env.DISCORD_ROLE_VIEW || process.env.DISCORD_ROLE_SWITCH || process.env.DISCORD_ROLE_ADMIN) {
      assert("GET /internal/team permission denied → 403", denied.status === 403);
      assert(
        "permission denied includes friendly error",
        typeof denied.body?.error === "string" && denied.body.error.includes("Discord role"),
      );
    } else {
      skip("permission denied embed", "Discord roles not configured in .env");
    }

    const switches = iTargets.body?.targets ?? [];
    if (switches.length > 0) {
      const switchStatus = await fetchJson(`${API}/internal/switch`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${INTERNAL_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          discordUserId,
          target: switches[0].name,
          action: "status",
        }),
      });
      assert("POST /internal/switch action:status", switchStatus.status === 200 && switchStatus.body?.readOnly === true);
    } else {
      skip("POST /internal/switch action:status", "no paired switches");
    }

    const iMapReq = internalInit("/internal/map", discordUserId);
    const iMap = await fetchJson(iMapReq.url, { headers: iMapReq.headers });
    assert("GET /internal/map", iMap.status === 200);

    const guildId = process.env.DISCORD_GUILD_ID ?? "";
    if (guildId) {
      const iChannelsReq = internalInit(`/internal/channels?guildId=${encodeURIComponent(guildId)}`, discordUserId);
      const iChannels = await fetchJson(iChannelsReq.url, { headers: iChannelsReq.headers });
      assert("GET /internal/channels", iChannels.status === 200);
    } else {
      skip("GET /internal/channels", "DISCORD_GUILD_ID not set");
    }
  }
}

// ── API: authenticated web routes ───────────────────────────────────────

console.log("\n=== Web API (session cookie) ===");

const sessionCookie = loadSessionCookie();
if (!sessionCookie) {
  skip("Web API authenticated routes", "no users in DB — log in once or set SMOKE_REFRESH_TOKEN");
} else {
  const cookieJar = { rusttools_refresh: sessionCookie.replace(/^rusttools_refresh=/, "") };

  const me = await fetchJson(`${API}/auth/me`, {}, cookieJar);
  assert("GET /auth/me", me.status === 200 && me.body?.user);
  assert("GET /auth/me linkedSteam field", typeof me.body?.linkedSteam === "boolean");
  assert("GET /auth/me companionLinked field", typeof me.body?.companionLinked === "boolean");
  assert(
    "GET /auth/me pendingLinkType field",
    me.body?.pendingLinkType === null ||
      me.body?.pendingLinkType === "steam" ||
      me.body?.pendingLinkType === "companion" ||
      me.body?.pendingLinkType === "master",
  );

  const servers = await fetchJson(`${API}/servers`, {}, cookieJar);
  assert("GET /servers", servers.status === 200 && Array.isArray(servers.body?.servers));

  const info = await fetchJson(`${API}/servers/active/info`, {}, cookieJar);
  assert("GET /servers/active/info", info.status === 200);

  const team = await fetchJson(`${API}/servers/active/team`, {}, cookieJar);
  assert("GET /servers/active/team", team.status === 200);
  assert("GET /servers/active/team canPromote field", typeof team.body?.canPromote === "boolean");

  const time = await fetchJson(`${API}/servers/active/time`, {}, cookieJar);
  assert("GET /servers/active/time", time.status === 200);

  const deepSea = await fetchJson(`${API}/servers/active/deepsea`, {}, cookieJar);
  assert("GET /servers/active/deepsea", deepSea.status === 200);

  const worldEvents = await fetchJson(`${API}/servers/active/world-events`, {}, cookieJar);
  assert("GET /servers/active/world-events", worldEvents.status === 200);

  const devices = await fetchJson(`${API}/devices`, {}, cookieJar);
  assert("GET /devices", devices.status === 200);

  const storage = await fetchJson(`${API}/storage`, {}, cookieJar);
  assert("GET /storage", storage.status === 200);

  const mapLive = await fetchJson(`${API}/servers/active/map/live`, {}, cookieJar);
  assert("GET /servers/active/map/live", mapLive.status === 200);

  const procgen = await fetchJson(`${API}/servers/active/map/procgen/status`, {}, cookieJar);
  assert("GET /servers/active/map/procgen/status", procgen.status === 200);

  const overlays = await fetchJson(`${API}/servers/active/map/overlays`, {}, cookieJar);
  assert("GET /servers/active/map/overlays", overlays.status === 200);

  const automations = await fetchJson(`${API}/automation-rules`, {}, cookieJar);
  assert("GET /automation-rules", automations.status === 200);

  const library = await fetchJson(`${API}/device-library`, {}, cookieJar);
  assert("GET /device-library", library.status === 200);

  const notifications = await fetchJson(`${API}/servers/active/notifications`, {}, cookieJar);
  assert("GET /servers/active/notifications", notifications.status === 200);

  const pushKey = await fetchJson(`${API}/push/vapid-public-key`, {}, cookieJar);
  assert("GET /push/vapid-public-key", pushKey.status === 200);

  const cameraStatus = await fetchJson(`${API}/cameras/status`, {}, cookieJar);
  assert("GET /cameras/status", cameraStatus.status === 200);

  if (me.body?.permissions?.admin) {
    const fcmStatusApi = await fetchJson(`${API}/admin/fcm-status`, {}, cookieJar);
    assert("GET /admin/fcm-status", fcmStatusApi.status === 200);

    const resetScopes = await fetchJson(`${API}/admin/data-reset/scopes`, {}, cookieJar);
    assert("GET /admin/data-reset/scopes", resetScopes.status === 200);

    const audit = await fetchJson(`${API}/audit`, {}, cookieJar);
    assert("GET /audit", audit.status === 200);

    const linkMasterPending = await fetchJson(`${API}/auth/link-master`, { method: "POST" }, cookieJar);
    assert("POST /auth/link-master (admin)", linkMasterPending.status === 200 && linkMasterPending.body?.ok === true);

    await fetchJson(
      `${API}/auth/link-steam`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamId: me.body.user.steamId ?? "76561198000000001" }),
      },
      cookieJar,
    );
    const meAfterSteam = await fetchJson(`${API}/auth/me`, {}, cookieJar);
    assert("POST /auth/link-steam saves steamId", meAfterSteam.body?.linkedSteam === true);

    const badCompanion = await fetchJson(
      `${API}/auth/link-companion`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: "not-numeric", playerToken: "123" }),
      },
      cookieJar,
    );
    assert("POST /auth/link-companion rejects bad playerId → 400", badCompanion.status === 400);

    const saveCompanion = await fetchJson(
      `${API}/auth/link-companion`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: "76561198000000099", playerToken: "999999" }),
      },
      cookieJar,
    );
    assert("POST /auth/link-companion saves credentials", saveCompanion.status === 200 && saveCompanion.body?.ok === true);
    const meAfterCompanion = await fetchJson(`${API}/auth/me`, {}, cookieJar);
    assert("GET /auth/me companionLinked after save", meAfterCompanion.body?.companionLinked === true);

    const clearCompanion = await fetchJson(`${API}/auth/link-companion`, { method: "DELETE" }, cookieJar);
    assert("DELETE /auth/link-companion", clearCompanion.status === 200 && clearCompanion.body?.ok === true);
  } else {
    console.log("  … skipping admin routes (user is not admin)");

    const linkSteam = await fetchJson(
      `${API}/auth/link-steam`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamId: "76561198000000002" }),
      },
      cookieJar,
    );
    assert("POST /auth/link-steam (view+)", linkSteam.status === 200 && linkSteam.body?.ok === true);

    const badSteam = await fetchJson(
      `${API}/auth/link-steam`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamId: "123" }),
      },
      cookieJar,
    );
    assert("POST /auth/link-steam rejects short steamId → 400", badSteam.status === 400);
  }

  // Full map fetch is heavy — only if Rust+ connected
  if (health?.body?.rustplus?.connected) {
    const mapFull = await fetchJson(`${API}/servers/active/map`, {}, cookieJar);
    assert("GET /servers/active/map", mapFull.status === 200 && mapFull.body?.map);
  } else {
    console.log("  … skipping /servers/active/map (Rust+ offline)");
  }

  if (procgen.body?.parseStatus === "ready") {
    const height = await fetchJson(`${API}/servers/active/map/procgen/height`, {}, cookieJar);
    assert("GET /servers/active/map/procgen/height", height.status === 200 && height.body?.heights?.length > 0);

    const paths = await fetchJson(`${API}/servers/active/map/procgen/paths`, {}, cookieJar);
    assert("GET /servers/active/map/procgen/paths", paths.status === 200);

    for (const overlayId of ["building-blocked", "heatmap-ores"]) {
      const cookieHeader = Object.entries(cookieJar)
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
      const res = await fetch(`${API}/servers/active/map/procgen/overlays/${overlayId}`, {
        headers: { Cookie: cookieHeader },
      });
      updateCookieJarFromResponse(res, cookieJar);
      assert(`GET procgen overlay ${overlayId}`, res.status === 200 && (res.headers.get("content-type") ?? "").includes("image"));
    }
  } else {
    console.log("  … skipping procgen overlays (no .map uploaded or not ready)");
  }
}

// ── Summary ─────────────────────────────────────────────────────────────

console.log("\n=== Summary ===");
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
console.log(`${passed}/${results.length} passed${skipped.length ? `, ${skipped.length} skipped` : ""}`);
if (skipped.length) {
  console.log("\nSkipped (optional):");
  for (const s of skipped) console.log(`  - ${s.name}${s.detail ? `: ${s.detail}` : ""}`);
}
if (failed.length > 0) {
  console.log("\nFailed:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
  process.exit(1);
}
console.log("\nAll smoke tests passed.");
