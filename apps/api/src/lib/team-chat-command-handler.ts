import type { Database } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import {
  formatDeepSeaTeamChatMessage,
  formatRosterCommandResponse,
  formatEventChatCommandResponse,
  formatUpkeepDetailReport,
  parseEventTeamChatCommand,
  formatTeamChatHelpReplies,
  parseDeepSeaTeamChatCommand,
  parseHelpTeamChatCommand,
  parseLeaderTeamChatCommand,
  parseMuteTeamChatCommand,
  parseRosterTeamChatCommand,
  parseSendTeamChatCommand,
  parseUnmuteTeamChatCommand,
  parseUpkeepDetailTeamChatCommand,
} from "@rusttools/shared";
import { configuredGuildId } from "./discord-channels.js";
import { hasDiscordCapability } from "./discord-permissions.js";
import { isDiscordBlacklisted } from "./discord-blacklist.js";
import { fetchDeepSeaStatus } from "./deep-sea.js";
import { sendDiscordDirectMessage } from "./discord-dm.js";
import { findDiscordUserIdForSendTarget } from "./discord-send-target.js";
import { getWorldSize, parseTeamRoster } from "./rust-data.js";
import {
  getActiveServerRow,
  promoteTeamLeader,
  PromoteLeaderError,
} from "./promote-leader.js";
import {
  getServerNotificationSettings,
  updateTeamChatBotSettings,
} from "./server-notification-settings.js";
import { hasSteamAdminCapability, steamIdForDiscordUser } from "./steam-admin.js";
import { processTeamRosterWithSettings } from "./team-tracker.js";
import { fetchTcUpkeepReportEntries } from "./tc-upkeep-report.js";
import { fetchWorldEventsStatus } from "./world-events-status.js";
import { executeSwitchChatCommand } from "./switch-command-handler.js";
import {
  buildDeepSeaEmbed,
  buildEventEmbed,
  buildHelpTeamChatEmbed,
  buildNoticeEmbed,
  buildRosterEmbed,
  buildSwitchReplyEmbed,
  buildUpkeepEmbed,
} from "./team-chat-discord-embeds.js";

function forDiscord(
  ctx: TeamChatCommandContext,
  result: TeamChatCommandResult,
  embeds: import("./discord-messages.js").DiscordEmbedPayload[],
): TeamChatCommandResult {
  if (!ctx.discordUserId) return result;
  return { ...result, embeds };
}

export interface TeamChatCommandContext {
  serverId: string;
  message: string;
  senderSteamId?: string;
  senderName?: string;
  /** Discord user running a `!` command from the commands channel. */
  discordUserId?: string;
  discordUsername?: string;
}

export interface TeamChatCommandResult {
  reply?: string;
  /** When set, each string is sent as its own team chat message (order preserved). */
  replies?: string[];
  /** Rich Discord embeds for slash-command callers. */
  embeds?: import("./discord-messages.js").DiscordEmbedPayload[];
}

const lastCommandAtMs = new Map<string, number>();

function isControlCommand(message: string): boolean {
  return (
    parseMuteTeamChatCommand(message) ||
    parseUnmuteTeamChatCommand(message) ||
    parseHelpTeamChatCommand(message)
  );
}

async function isCommandAdmin(
  db: Database,
  ctx: TeamChatCommandContext,
): Promise<boolean> {
  if (ctx.discordUserId) {
    return hasDiscordCapability(ctx.discordUserId, "admin");
  }
  if (ctx.senderSteamId) {
    return hasSteamAdminCapability(db, ctx.senderSteamId);
  }
  return false;
}

async function resolveSenderSteamId(
  db: Database,
  ctx: TeamChatCommandContext,
): Promise<string | null> {
  if (ctx.senderSteamId) return ctx.senderSteamId;
  if (ctx.discordUserId) {
    return steamIdForDiscordUser(db, ctx.discordUserId);
  }
  return null;
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
    if (!(await isCommandAdmin(db, ctx))) {
      const reply = "RustTools: Only admins can mute the bot.";
      return forDiscord(ctx, { reply }, [buildNoticeEmbed(reply, { title: "Mute bot", kind: "error" })]);
    }
    await updateTeamChatBotSettings(db, ctx.serverId, { muted: true });
    const reply = "RustTools: Bot muted in team chat.";
    return forDiscord(ctx, { reply }, [buildNoticeEmbed(reply, { title: "Bot muted", kind: "warning" })]);
  }

  if (parseUnmuteTeamChatCommand(message)) {
    if (!(await isCommandAdmin(db, ctx))) {
      const reply = "RustTools: Only admins can unmute the bot.";
      return forDiscord(ctx, { reply }, [buildNoticeEmbed(reply, { title: "Unmute bot", kind: "error" })]);
    }
    await updateTeamChatBotSettings(db, ctx.serverId, { muted: false });
    const reply = "RustTools: Bot unmuted in team chat.";
    return forDiscord(ctx, { reply }, [buildNoticeEmbed(reply, { title: "Bot unmuted", kind: "success" })]);
  }

  if (parseHelpTeamChatCommand(message)) {
    const replies = formatTeamChatHelpReplies(ctx.discordUserId != null);
    return forDiscord(ctx, { replies }, [buildHelpTeamChatEmbed()]);
  }

  const guildId = configuredGuildId();
  if (guildId) {
    if (ctx.senderSteamId) {
      const blocked = await isDiscordBlacklisted(db, guildId, { steamId: ctx.senderSteamId });
      if (blocked) {
        const reply = "RustTools: You are blocked from bot commands.";
        return forDiscord(ctx, { reply }, [buildNoticeEmbed(reply, { kind: "error" })]);
      }
    }
    if (ctx.discordUserId) {
      const blocked = await isDiscordBlacklisted(db, guildId, { discordId: ctx.discordUserId });
      if (blocked) {
        const reply = "RustTools: You are blocked from bot commands.";
        return forDiscord(ctx, { reply }, [buildNoticeEmbed(reply, { kind: "error" })]);
      }
    }
  }

  if (settings.teamChatBot.muted) {
    if (ctx.discordUserId) {
      const reply = "RustTools: Bot is muted in team chat. Admins: !unmute or Settings → Team Chat.";
      return forDiscord(ctx, { reply }, [buildNoticeEmbed(reply, { title: "Bot muted", kind: "warning" })]);
    }
    return null;
  }

  if (shouldThrottleTeamChatCommand(ctx.serverId, message, settings.teamChatBot.commandDelayMs)) {
    if (ctx.discordUserId) {
      const reply = "RustTools: Slow down — try again in a moment.";
      return forDiscord(ctx, { reply }, [buildNoticeEmbed(reply, { kind: "warning" })]);
    }
    return null;
  }

  const send = parseSendTeamChatCommand(message);
  if (send) {
    const recipient = await findDiscordUserIdForSendTarget(db, send.target);
    if (!recipient) {
      const reply = `RustTools: No linked Discord user matches "${send.target}". They must log in to the web dashboard first.`;
      return forDiscord(ctx, { reply }, [buildNoticeEmbed(reply, { title: "Send failed", kind: "error" })]);
    }
    const from =
      ctx.senderName?.trim() ||
      ctx.discordUsername?.trim() ||
      "Teammate";
    await sendDiscordDirectMessage(
      recipient.discordId,
      `**${from}** (via RustTools): ${send.text}`,
    );
    const reply = `RustTools: Message sent to ${recipient.discordUsername} on Discord.`;
    return forDiscord(ctx, { reply }, [
      buildNoticeEmbed(`Message sent to **${recipient.discordUsername}** on Discord.`, {
        title: "Discord DM sent",
        kind: "success",
      }),
    ]);
  }

  if (parseDeepSeaTeamChatCommand(message)) {
    const status = await fetchDeepSeaStatus(db, rustPlus, ctx.serverId);
    const reply = formatDeepSeaTeamChatMessage(status);
    return forDiscord(ctx, { reply }, [buildDeepSeaEmbed(status)]);
  }

  if (parseUpkeepDetailTeamChatCommand(message)) {
    const entries = await fetchTcUpkeepReportEntries(db, rustPlus, ctx.serverId);
    const replies = formatUpkeepDetailReport(entries);
    return forDiscord(ctx, { replies }, [buildUpkeepEmbed(entries)]);
  }

  const eventCommand = parseEventTeamChatCommand(message);
  if (eventCommand) {
    const status = await fetchWorldEventsStatus(db, rustPlus, ctx.serverId);
    const response = formatEventChatCommandResponse(eventCommand, status);
    if (eventCommand === "events") {
      return forDiscord(ctx, { replies: response.split("\n") }, [buildEventEmbed(eventCommand, status)]);
    }
    return forDiscord(ctx, { reply: response }, [buildEventEmbed(eventCommand, status)]);
  }

  const rosterCommand = parseRosterTeamChatCommand(message);
  if (rosterCommand) {
    const [team, info] = await Promise.all([rustPlus.getTeamInfo(), rustPlus.getServerInfo()]);
    const worldSize = getWorldSize(info);
    const parsed = parseTeamRoster(team, worldSize);
    const { team: tracked } = await processTeamRosterWithSettings(db, ctx.serverId, parsed, worldSize);
    const reply = formatRosterCommandResponse(rosterCommand, tracked);
    return forDiscord(ctx, { reply }, [buildRosterEmbed(rosterCommand, tracked, worldSize)]);
  }

  if (parseLeaderTeamChatCommand(message)) {
    const senderSteamId = await resolveSenderSteamId(db, ctx);
    if (!senderSteamId) {
      const reply =
        "RustTools: Link your Steam ID in the web dashboard (Settings → Account) to use !leader.";
      return forDiscord(ctx, { reply }, [buildNoticeEmbed(reply, { title: "Promote leader", kind: "error" })]);
    }

    const activeServer = await getActiveServerRow(db);
    if (!activeServer || activeServer.id !== ctx.serverId) {
      const reply = "RustTools: No active server.";
      return forDiscord(ctx, { reply }, [buildNoticeEmbed(reply, { kind: "error" })]);
    }

    const [team, info] = await Promise.all([rustPlus.getTeamInfo(), rustPlus.getServerInfo()]);
    const worldSize = getWorldSize(info);
    const parsed = parseTeamRoster(team, worldSize);

    if (!parsed.leaderSteamId) {
      const reply = "RustTools: No team leader found.";
      return forDiscord(ctx, { reply }, [buildNoticeEmbed(reply, { title: "Promote leader", kind: "error" })]);
    }

    const sender = parsed.members.find((m) => m.steamId === senderSteamId);
    if (!sender) {
      const reply = "RustTools: You must be on the team to use !leader.";
      return forDiscord(ctx, { reply }, [buildNoticeEmbed(reply, { title: "Promote leader", kind: "error" })]);
    }

    if (sender.isLeader) {
      const reply = "RustTools: You are already team leader.";
      return forDiscord(ctx, { reply }, [buildNoticeEmbed(reply, { title: "Promote leader", kind: "info" })]);
    }

    try {
      await promoteTeamLeader(
        db,
        rustPlus,
        activeServer,
        parsed.leaderSteamId,
        sender.steamId,
        sender,
      );
    } catch (err) {
      const reply =
        err instanceof PromoteLeaderError
          ? `RustTools: ${err.message}`
          : "RustTools: Failed to promote team leader.";
      return forDiscord(ctx, { reply }, [
        buildNoticeEmbed(reply, { title: "Promote leader", kind: "error" }),
      ]);
    }

    const reply = `RustTools: ${sender.name} is now team leader.`;
    return forDiscord(ctx, { reply }, [
      buildNoticeEmbed(`**${sender.name}** is now team leader.`, {
        title: "Team leader updated",
        kind: "success",
      }),
    ]);
  }

  const switchResult = await executeSwitchChatCommand(db, rustPlus, ctx.serverId, message);
  if (switchResult) {
    return forDiscord(ctx, { reply: switchResult.reply }, [buildSwitchReplyEmbed(switchResult.reply)]);
  }

  if (ctx.discordUserId) {
    const reply = "RustTools: Unknown command. Type !help for the list.";
    return forDiscord(ctx, { reply }, [buildNoticeEmbed(reply, { kind: "error" })]);
  }
  return null;
}

export async function isTeamChatBotMuted(db: Database, serverId: string): Promise<boolean> {
  const settings = await getServerNotificationSettings(db, serverId);
  return settings.teamChatBot.muted;
}
