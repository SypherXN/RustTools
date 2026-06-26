import type { Database } from "@rusttools/db";
import type { RustPlusManager, NotificationService } from "@rusttools/rustplus-client";
import type { TeamChatMessage } from "@rusttools/shared";
import { formatAttributedTeamChatMessage } from "@rusttools/shared";
import { getWorldSize, parseTeamRoster } from "./rust-data.js";
import { recordTeamChatMessage } from "./team-chat-buffer.js";
import { isTeamChatBotMuted } from "./team-chat-command-handler.js";

export function publishTeamChatMessage(
  serverId: string,
  message: TeamChatMessage,
  notifications?: NotificationService,
): void {
  recordTeamChatMessage(serverId, message);
  notifications?.webSocket({
    event: "teamChat",
    payload: {
      serverId,
      steamId: message.steamId,
      name: message.name,
      message: message.message,
      sentAt: message.sentAt,
    },
  });
}

export async function buildPublishedTeamChatEntry(
  rustPlus: RustPlusManager,
  pairedPlayerId: string | null,
  senderLabel: string,
  outboundMessage: string,
): Promise<TeamChatMessage> {
  let name = senderLabel.trim() || "Unknown";
  const steamId = pairedPlayerId ?? "0";

  try {
    const [team, info] = await Promise.all([rustPlus.getTeamInfo(), rustPlus.getServerInfo()]);
    const parsed = parseTeamRoster(team, getWorldSize(info));
    const member = parsed.members.find((m) => m.steamId === pairedPlayerId);
    if (member?.name) name = member.name;
  } catch {
    // fall back to sender label
  }

  return {
    steamId,
    name,
    message: outboundMessage,
    sentAt: Math.floor(Date.now() / 1000),
  };
}

/** Send attributed team chat and push to WebSocket clients + in-memory history. */
export async function sendAndPublishTeamChat(
  rustPlus: RustPlusManager,
  serverId: string,
  pairedPlayerId: string | null,
  senderLabel: string,
  message: string,
): Promise<TeamChatMessage> {
  const outbound = formatAttributedTeamChatMessage(senderLabel, message);
  await rustPlus.sendTeamMessage(outbound);
  const entry = await buildPublishedTeamChatEntry(
    rustPlus,
    pairedPlayerId,
    senderLabel,
    outbound,
  );
  publishTeamChatMessage(serverId, entry, rustPlus.notifications);
  return entry;
}

export async function sendTeamChatIfUnmuted(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
  message: string,
  force = false,
): Promise<boolean> {
  if (!force && (await isTeamChatBotMuted(db, serverId))) return false;
  await rustPlus.sendTeamMessage(message);
  return true;
}

export async function sendTeamChatCommandResult(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
  result: { reply?: string; replies?: string[] },
  force = false,
): Promise<void> {
  const messages = result.replies?.length
    ? result.replies
    : result.reply
      ? [result.reply]
      : [];

  for (const message of messages) {
    await sendTeamChatIfUnmuted(db, rustPlus, serverId, message, force);
  }
}
