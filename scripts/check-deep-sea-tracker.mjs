// Run after building shared and API packages.
import assert from "node:assert/strict";
import { DeepSeaTracker, monumentsFromMap } from "../apps/api/dist/lib/deep-sea-tracker.js";

const tracker = new DeepSeaTracker();
const monuments = monumentsFromMap({
  monuments: [{ token: "deep_sea_display_name", x: 10, y: 20 }],
});
assert.equal(tracker.getStatus("server").phase, "unknown");
const opened = tracker.process("server", { monuments }, 100);
assert.equal(opened.transition, "opened");
assert.equal(opened.status.isOpen, true);
assert.equal(opened.status.deepSeaMonumentCount, 1);
assert.equal(opened.status.openedAt, 100);
assert.equal(tracker.process("server", { monuments }, 110).transition, null);
assert.equal(tracker.getStatus("other").phase, "unknown");
const closed = tracker.process("server", { monuments: [] }, 120);
assert.equal(closed.transition, "closed");
assert.equal(closed.status.isOpen, false);
assert.equal(closed.status.closedAt, 120);
assert.equal(closed.status.openedAt, null);
assert.equal(tracker.process("server", { monuments: [] }, 130).transition, null);
tracker.reset("server");
assert.equal(tracker.getStatus("server").phase, "unknown");
console.log("Deep-sea monument tracking checks passed.");
