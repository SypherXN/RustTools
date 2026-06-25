import { env } from "../config.js";

export async function sendDiscordDirectMessage(
  discordUserId: string,
  content: string,
): Promise<void> {
  if (!env.discord.botToken) {
    throw new Error("Discord bot token is not configured");
  }

  const dmRes = await fetch("https://discord.com/api/users/@me/channels", {
    method: "POST",
    headers: {
      Authorization: `Bot ${env.discord.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: discordUserId }),
  });

  if (!dmRes.ok) {
    throw new Error(`Failed to open Discord DM channel (${dmRes.status})`);
  }

  const dm = (await dmRes.json()) as { id: string };

  const msgRes = await fetch(`https://discord.com/api/channels/${dm.id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${env.discord.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });

  if (!msgRes.ok) {
    throw new Error(`Failed to send Discord DM (${msgRes.status})`);
  }
}
