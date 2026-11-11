/**
 * Team-chat send must hit the wire at most once per call.
 *
 * sendTeamMessage is not idempotent: if the server accepts the message and the
 * ack is lost, a retry sends the same text twice. This check drives
 * RustPlusManager.sendTeamMessage with a fake private connection (no network,
 * no credentials) and deterministic mock timers.
 *
 * Run against built dist: node scripts/check-team-chat-send-once.mjs
 */
import assert from "node:assert/strict";
import { mock } from "node:test";
import { RustPlusManager } from "../packages/rustplus-client/dist/index.js";

const MESSAGE = "same-click test";

/** Let queued promise jobs run without touching real time. */
async function flushMicrotasks() {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

/**
 * Build a manager whose active connection is a fake client that records every
 * underlying send. `behavior` decides how (or whether) the ack arrives.
 */
function harness(behavior) {
  const sends = [];
  const client = {
    sendTeamMessage(message, callback) {
      sends.push(message);
      behavior({ sends, callback, attempt: sends.length });
    },
  };
  const manager = new RustPlusManager();
  manager.activeServerId = "fake-server";
  manager.connections.set("fake-server", {
    credentials: {
      id: "fake-server",
      ip: "127.0.0.1",
      port: 1,
      playerId: "0",
      playerToken: "0",
      name: "fake",
    },
    client,
    subscribedEntities: new Set(),
  });
  return { manager, sends };
}

/** Start a send and settle it by advancing mock timers until it resolves/rejects. */
async function drive(manager) {
  let settled = false;
  const outcome = manager.sendTeamMessage(MESSAGE).then(
    (value) => {
      settled = true;
      return { ok: true, value };
    },
    (error) => {
      settled = true;
      return { ok: false, error };
    },
  );
  for (let tick = 0; tick < 200 && !settled; tick += 1) {
    await flushMicrotasks();
    mock.timers.tick(1_000);
  }
  await flushMicrotasks();
  return outcome;
}

function assertSingleSend(sends) {
  assert.equal(
    sends.length,
    1,
    `expected exactly 1 underlying send, got ${sends.length} (retry would duplicate the message)`,
  );
}

const scenarios = [
  {
    name: "timeout after acceptance: one send, rejects",
    async run() {
      const { manager, sends } = harness(() => {
        // Server accepted the message but the ack never arrives.
      });
      const result = await drive(manager);
      assert.equal(result.ok, false, "timeout must reject, not resolve");
      assert.match(String(result.error?.message), /timed out/i);
      assertSingleSend(sends);
      assert.equal(sends[0], MESSAGE);
    },
  },
  {
    name: "rate_limit before acceptance (sync error): one send, rejects",
    async run() {
      const { manager, sends } = harness(({ callback }) => {
        callback({ response: { error: { error: "rate_limit" } } });
      });
      const result = await drive(manager);
      assert.equal(result.ok, false);
      assert.match(String(result.error?.message), /rate limit/i);
      assertSingleSend(sends);
    },
  },
  {
    name: "rate_limit after acceptance (late error): one send, rejects",
    async run() {
      const { manager, sends } = harness(({ callback }) => {
        // Ack lands after the request was already on the wire.
        setTimeout(() => callback({ response: { error: { error: "rate_limit" } } }), 50);
      });
      const result = await drive(manager);
      assert.equal(result.ok, false);
      assert.match(String(result.error?.message), /rate limit/i);
      assertSingleSend(sends);
    },
  },
  {
    name: "genuine message_not_sent: one send, error propagated",
    async run() {
      const { manager, sends } = harness(({ callback }) => {
        callback({ response: { error: { error: "message_not_sent" } } });
      });
      const result = await drive(manager);
      assert.equal(result.ok, false);
      assert.match(String(result.error?.message), /message_not_sent/);
      assertSingleSend(sends);
    },
  },
  {
    name: "normal success: one send, resolves",
    async run() {
      const { manager, sends } = harness(({ callback }) => {
        callback({ response: {} });
      });
      const result = await drive(manager);
      assert.equal(result.ok, true, "success must resolve");
      assertSingleSend(sends);
    },
  },
  {
    name: "two sequential intentional identical messages: both sent",
    async run() {
      const { manager, sends } = harness(({ callback }) => {
        callback({ response: {} });
      });
      const first = await drive(manager);
      const second = await drive(manager);
      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      assert.equal(sends.length, 2, "identical intentional messages must not be deduped");
      assert.deepEqual(sends, [MESSAGE, MESSAGE]);
    },
  },
];

const failures = [];
mock.timers.enable({ apis: ["setTimeout"] });
try {
  for (const scenario of scenarios) {
    try {
      await scenario.run();
      console.log(`PASS ${scenario.name}`);
    } catch (error) {
      failures.push({ scenario: scenario.name, error });
      console.error(`FAIL ${scenario.name}: ${error instanceof Error ? error.message : error}`);
    }
  }
} finally {
  mock.timers.reset();
}

if (failures.length > 0) {
  console.error(`team chat send-once check failed: ${failures.length}/${scenarios.length} scenarios`);
  process.exitCode = 1;
} else {
  console.log(`team chat send-once check passed: ${scenarios.length}/${scenarios.length} scenarios`);
}
