// Run after the shared build: node packages/shared/tests/deep-sea-settings.mjs
import assert from "node:assert/strict";
import { detectDeepSeaOpen, buildDeepSeaStatus, formatDeepSeaDiscordDescription } from "../dist/deep-sea.js";
import { parseServerNotificationSettings } from "../dist/notification-settings.js";

assert.deepEqual(detectDeepSeaOpen([]), { isOpen: false, deepSeaMonumentCount: 0 });
assert.deepEqual(detectDeepSeaOpen([{ token: "harbor" }]), {
  isOpen: false, deepSeaMonumentCount: 0,
});
const detection = detectDeepSeaOpen([
  { token: "deep_sea" }, { token: "Deep Sea" }, { token: "harbor" },
]);
assert.deepEqual(detection, { isOpen: true, deepSeaMonumentCount: 2 });
const status = buildDeepSeaStatus({
  ...detection, phase: "open", openedAt: 100, closedAt: null,
  nowSec: 110, openDurationSec: 60,
});
assert.deepEqual(status, {
  phase: "open", isOpen: true, deepSeaMonumentCount: 2,
  openedAt: 100, closedAt: null, nextTransitionAt: 160,
  secondsRemaining: 50, label: "Open — closes in ~50s", source: "detected",
});
assert.equal(formatDeepSeaDiscordDescription(status), `${status.label}\nDeep sea monuments: 2`);

const retained = {
  nightLights: { enabled: true, entityIds: [123] },
  teamOfflineSam: { enabled: true, switchEntityId: 456 },
};
const settings = parseServerNotificationSettings(JSON.stringify({
  smartAlarm: { discord: false },
  eventTimers: { cargoEgressSeconds: 10 },
  legacyAutomations: { ...retained, mapEvents: { teamChat: true } },
}));
assert.equal(settings.smartAlarm.discord, false);
assert.equal("eventTimers" in settings, false);
assert.deepEqual(settings.legacyAutomations, retained);
assert.deepEqual(
  Object.keys(parseServerNotificationSettings(null).legacyAutomations).sort(),
  ["nightLights", "teamOfflineSam"],
);
