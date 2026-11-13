import type { Database } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import {
  formatDeepSeaTeamChatMessage,
  formatServerPop,
  formatRosterCommandResponse,
  formatUpkeepDetailReport,
  formatTeamChatHelpReplies,
  parseDeepSeaTeamChatCommand,
  parseHelpTeamChatCommand,
  parseLeaderTeamChatCommand,
  parseMuteTeamChatCommand,
  parseRosterTeamChatCommand,
  parseSendTeamChatCommand,
  parseUnmuteTeamChatCommand,
  parseUpkeepDetailTeamChatCommand,
  parseServerMapMeta,
  teamMemberStatus,
  worldToGridLabel,
} from "@rusttools/shared";
import { configuredGuildId } from "./discord-channels.js";
import { hasDiscordCapability } from "./discord-permissions.js";
import { isDiscordBlacklisted } from "./discord-blacklist.js";
import { fetchDeepSeaStatus } from "./deep-sea.js";
import { sendDiscordDirectMessage } from "./discord-dm.js";
import { findDiscordUserIdForSendTarget } from "./discord-send-target.js";
import { getWorldSize, parseInGameTime, parseTeamRoster } from "./rust-data.js";
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
import { executeSwitchChatCommand } from "./switch-command-handler.js";
import {
  buildDeepSeaEmbed,
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

  const infoCommand = message.toLowerCase().split(/\s+/)[0];
  if (infoCommand === "!status") {
    const status = rustPlus.getStatus();
    const reply = `RustTools: Rust+ ${status.connected ? "connected" : "disconnected"} · FCM ${status.fcmListening ? "listening" : "not listening"}.`;
    return forDiscord(ctx, { reply }, [buildNoticeEmbed(reply, { title: "Status" })]);
  }
  if (infoCommand === "!pop" || infoCommand === "!map") {
    const info = await rustPlus.getServerInfo();
    const map = infoCommand === "!map" ? parseServerMapMeta(info) : null;
    const details = map && [
      map.mapName,
      map.seed != null ? `Seed: ${map.seed}` : null,
      map.mapSize != null ? `Size: ${map.mapSize}m` : null,
    ].filter(Boolean).join(" · ");
    const reply = map ? `RustTools: Map: ${details || "unavailable"}` : formatServerPop(info);
    return forDiscord(ctx, { reply }, [buildNoticeEmbed(reply, { title: map ? "Map" : "Pop" })]);
  }
  if (infoCommand === "!time") {
    const time = parseInGameTime(await rustPlus.getTime());
    const phase = time.isDay == null ? "" : time.isDay ? " (day)" : " (night)";
    const reply = `RustTools: Time: ${time.time ? time.time + phase : "unavailable"}`;
    return forDiscord(ctx, { reply }, [buildNoticeEmbed(reply, { title: "Time" })]);
  }
  if (infoCommand === "!team") {
    const [team, info] = await Promise.all([rustPlus.getTeamInfo(), rustPlus.getServerInfo()]);
    const worldSize = getWorldSize(info);
    const parsed = parseTeamRoster(team, worldSize);
    const { team: tracked } = await processTeamRosterWithSettings(db, ctx.serverId, parsed, worldSize);
    const members = tracked.members.map((member) => {
      const grid = member.locationKnown && member.x != null && member.y != null && worldSize
        ? worldToGridLabel(member.x, member.y, worldSize) : null;
      return `${member.name} (${teamMemberStatus(member)}${grid ? ` @ ${grid}` : ""})`;
    });
    const reply = `RustTools: Team: ${members.join(", ") || "No teammates."}`;
    const replies: string[] = [];
    let remaining = reply;
    while (remaining.length > 120) {
      let end = remaining.lastIndexOf(", ", 118);
      if (end <= 0) {
        end = 120;
        if (/[\uD800-\uDBFF]/.test(remaining[end - 1]!)) end--;
      } else {
        end += 2;
      }
      replies.push(remaining.slice(0, end));
      remaining = remaining.slice(end);
    }
    if (remaining) replies.push(remaining);
    return forDiscord(ctx, replies.length === 1 ? { reply } : { replies }, [
      buildNoticeEmbed(reply, { title: "Team" }),
    ]);
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
    const status = await fetchDeepSeaStatus(rustPlus, ctx.serverId);
    const reply = formatDeepSeaTeamChatMessage(status);
    return forDiscord(ctx, { reply }, [buildDeepSeaEmbed(status)]);
  }

  if (parseUpkeepDetailTeamChatCommand(message)) {
    const entries = await fetchTcUpkeepReportEntries(db, rustPlus, ctx.serverId);
    const replies = formatUpkeepDetailReport(entries);
    return forDiscord(ctx, { replies }, [buildUpkeepEmbed(entries)]);
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
