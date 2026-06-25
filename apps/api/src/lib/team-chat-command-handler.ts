import type { Database } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import {
  formatDeepSeaTeamChatMessage,
  formatRosterCommandResponse,
  formatEventChatCommandResponse,
  parseEventTeamChatCommand,
  parseDeepSeaTeamChatCommand,
  parseLeaderTeamChatCommand,
  parseMuteTeamChatCommand,
  parseRosterTeamChatCommand,
  parseSendTeamChatCommand,
  parseUnmuteTeamChatCommand,
  parseUpkeepDetailTeamChatCommand,
} from "@rusttools/shared";
import { fetchDeepSeaStatus } from "./deep-sea.js";
import { sendDiscordDirectMessage } from "./discord-dm.js";
import { findDiscordUserIdForSendTarget } from "./discord-send-target.js";
import { getWorldSize, parseTeamRoster, getActiveServer } from "./rust-data.js";
import {
  getServerNotificationSettings,
  updateTeamChatBotSettings,
} from "./server-notification-settings.js";
import { hasSteamAdminCapability } from "./steam-admin.js";
import { processTeamRoster } from "./team-tracker.js";
import { buildUpkeepDetailTeamChatReplies } from "./tc-upkeep-report.js";
import { fetchWorldEventsStatus } from "./world-events-status.js";

export interface TeamChatCommandContext {
  serverId: string;
  senderSteamId?: string;
  senderName?: string;
  message: string;
}

export interface TeamChatCommandResult {
  reply?: string;
  /** When set, each string is sent as its own team chat message (order preserved). */
  replies?: string[];
}

const lastCommandAtMs = new Map<string, number>();

function isControlCommand(message: string): boolean {
  return parseMuteTeamChatCommand(message) || parseUnmuteTeamChatCommand(message);
}

export function shouldThrottleTeamChatCommand(
  serverId: string,
  message: string,
  commandDelayMs: number,
): boolean {
  if (commandDelayMs <= 0 || isControlCommand(message)) return false;

  const now = Date.now();
  const last = lastCommandAtMs.get(serverId) ?? 0;
  if (now - last < commandDelayMs) return true;

  lastCommandAtMs.set(serverId, now);
  return false;
}

export async function executeTeamChatCommand(
  db: Database,
  rustPlus: RustPlusManager,
  ctx: TeamChatCommandContext,
): Promise<TeamChatCommandResult | null> {
  const message = ctx.message.trim();
  if (!message.startsWith("!")) return null;

  const settings = await getServerNotificationSettings(db, ctx.serverId);

  if (parseMuteTeamChatCommand(message)) {
    if (!ctx.senderSteamId) {
      return { reply: "RustTools: !mute is only available from in-game team chat." };
    }
    if (!(await hasSteamAdminCapability(db, ctx.senderSteamId))) {
      return { reply: "RustTools: Only admins can mute the bot." };
    }
    await updateTeamChatBotSettings(db, ctx.serverId, { muted: true });
    return { reply: "RustTools: Bot muted in team chat." };
  }

  if (parseUnmuteTeamChatCommand(message)) {
    if (!ctx.senderSteamId) {
      return { reply: "RustTools: !unmute is only available from in-game team chat." };
    }
    if (!(await hasSteamAdminCapability(db, ctx.senderSteamId))) {
      return { reply: "RustTools: Only admins can unmute the bot." };
    }
    await updateTeamChatBotSettings(db, ctx.serverId, { muted: false });
    return { reply: "RustTools: Bot unmuted in team chat." };
  }

  if (settings.teamChatBot.muted) {
    return null;
  }

  if (shouldThrottleTeamChatCommand(ctx.serverId, message, settings.teamChatBot.commandDelayMs)) {
    return null;
  }

  const send = parseSendTeamChatCommand(message);
  if (send) {
    if (!ctx.senderSteamId) {
      return { reply: "RustTools: !send is only available from in-game team chat." };
    }
    const recipient = await findDiscordUserIdForSendTarget(db, send.target);
    if (!recipient) {
      return {
        reply: `RustTools: No linked Discord user matches "${send.target}". They must log in to the web dashboard first.`,
      };
    }
    const from = ctx.senderName?.trim() || "Teammate";
    await sendDiscordDirectMessage(
      recipient.discordId,
      `**${from}** (via RustTools): ${send.text}`,
    );
    return { reply: `RustTools: Message sent to ${recipient.discordUsername} on Discord.` };
  }

  if (parseDeepSeaTeamChatCommand(message)) {
    const status = await fetchDeepSeaStatus(db, rustPlus, ctx.serverId);
    return { reply: formatDeepSeaTeamChatMessage(status) };
  }

  if (parseUpkeepDetailTeamChatCommand(message)) {
    const replies = await buildUpkeepDetailTeamChatReplies(db, rustPlus, ctx.serverId);
    return { replies };
  }

  const eventCommand = parseEventTeamChatCommand(message);
  if (eventCommand) {
    const status = await fetchWorldEventsStatus(db, rustPlus, ctx.serverId);
    const response = formatEventChatCommandResponse(eventCommand, status);
    if (eventCommand === "events") {
      return { replies: response.split("\n") };
    }
    return { reply: response };
  }

  const rosterCommand = parseRosterTeamChatCommand(message);
  if (rosterCommand) {
    const [team, info] = await Promise.all([rustPlus.getTeamInfo(), rustPlus.getServerInfo()]);
    const worldSize = getWorldSize(info);
    const parsed = parseTeamRoster(team, worldSize);
    const { team: tracked } = processTeamRoster(ctx.serverId, parsed, worldSize);
    return { reply: formatRosterCommandResponse(rosterCommand, tracked) };
  }

  if (parseLeaderTeamChatCommand(message)) {
    if (!ctx.senderSteamId) {
      return { reply: "RustTools: !leader is only available from in-game team chat." };
    }

    const activeServer = await getActiveServer(db);
    if (!activeServer || activeServer.id !== ctx.serverId) {
      return { reply: "RustTools: No active server." };
    }

    const [team, info] = await Promise.all([rustPlus.getTeamInfo(), rustPlus.getServerInfo()]);
    const worldSize = getWorldSize(info);
    const parsed = parseTeamRoster(team, worldSize);

    if (!parsed.leaderSteamId || parsed.leaderSteamId !== activeServer.playerId) {
      return {
        reply:
          "RustTools: !leader is only available when RustTools is paired with the current team leader.",
      };
    }

    const sender = parsed.members.find((m) => m.steamId === ctx.senderSteamId);
    if (!sender) return null;

    if (sender.isLeader) {
      return { reply: "RustTools: You are already team leader." };
    }

    await rustPlus.promoteToLeader(sender.steamId);
    return { reply: `RustTools: ${sender.name} is now team leader.` };
  }

  return null;
}

export async function isTeamChatBotMuted(db: Database, serverId: string): Promise<boolean> {
  const settings = await getServerNotificationSettings(db, serverId);
  return settings.teamChatBot.muted;
}
