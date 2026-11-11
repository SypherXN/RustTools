import assert from "node:assert/strict";
import { buildTeamChatMirrorEmbed } from "../apps/api/dist/lib/team-chat-discord-embeds.js";

const embed = buildTeamChatMirrorEmbed(
  "<color=#55aaff>황예지</color>",
  "<color=red><b>Hello</b></color> 팀!",
);
assert.equal(embed.title, "황예지");
assert.equal(embed.description, "Hello 팀!");
assert.equal(buildTeamChatMirrorEmbed("<COLOR=blue> </COLOR>", "hello").title, "Unknown");
assert.equal(buildTeamChatMirrorEmbed("Player", "2 < 3 > 1").description, "2 < 3 > 1");
assert.equal(buildTeamChatMirrorEmbed("Player", "plain text").description, "plain text");
console.log("team-chat Discord markup checks passed");
