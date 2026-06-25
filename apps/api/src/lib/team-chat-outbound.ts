import type { Database } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { isTeamChatBotMuted } from "./team-chat-command-handler.js";

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
