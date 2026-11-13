import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatServerPop, isTeamChatBotCommand } from "../packages/shared/dist/index.js";
import { commands } from "../apps/discord-bot/dist/commands.js";

process.env.DISCORD_GUILD_ID = "";
const { executeTeamChatCommand } = await import("../apps/api/dist/lib/team-chat-command-handler.js");
let muted = false;
const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [
    { notificationSettingsJson: JSON.stringify({ teamChatBot: { muted, commandDelayMs: 0 } }) },
  ] }) }) }),
};
let calls = 0;
let members = [];
const rustPlus = {
  getStatus: () => ({ connected: true, fcmListening: false }),
  getServerInfo: async () => { calls++; return { players: 0, maxPlayers: 100, map: "Procedural Map", seed: 123, mapSize: 4000 }; },
  getTime: async () => ({ time: 12.5, sunrise: 6, sunset: 18 }),
  getTeamInfo: async () => ({ members }),
  getMap: async () => ({ monuments: [] }),
};
const run = (message) => executeTeamChatCommand(db, rustPlus, { serverId: "test", message });

assert(commands.some((command) => command.name === "pop"));
assert.equal(formatServerPop({ players: 0, maxPlayers: 100 }), "RustTools: Pop: 0/100");
assert.equal(formatServerPop({ queuedPlayers: 0 }), "RustTools: Pop: ?/? · Queue: 0");
for (const command of ["pop", "status", "time", "map", "team", "deepsea", "ds", "help"]) {
  assert(isTeamChatBotCommand(`!${command}`), command);
}
assert.match((await run("!POP")).reply, /Pop: 0\/100/);
assert.match((await run("!status")).reply, /connected.*not listening/);
assert.match((await run("!time")).reply, /12:30 \(day\)/);
assert.match((await run("!map")).reply, /Procedural Map.*123.*4000m/);
assert.match((await run("!team")).reply, /No teammates/);
members = Array.from({ length: 20 }, (_, i) => ({
  name: `Teammate${i}`, steamId: String(i + 1), isOnline: true, isAlive: true,
}));
const roster = await run("!team");
assert(roster.replies.length > 1);
assert(roster.replies.every((part) => part.length <= 120));
for (const member of members) assert(roster.replies.join("").includes(`${member.name} (`));
const botSource = readFileSync(new URL("../apps/discord-bot/src/index.ts", import.meta.url), "utf8");
const popCase = botSource.split('case "pop": {')[1].split('case "devices":')[0];
assert(popCase.indexOf("await interaction.deferReply()") >= 0);
assert(popCase.indexOf("await interaction.deferReply()") < popCase.indexOf("await internalFetch"));
assert.equal((await run("!deepsea")).reply, (await run("!ds")).reply);
assert((await run("!help")).replies.join(" ").includes("!pop"));
muted = true;
const before = calls;
assert.equal(await run("!pop"), null);
assert.equal(calls, before);
console.log("info commands: ok");
