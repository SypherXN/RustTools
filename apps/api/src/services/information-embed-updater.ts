import type { Database } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { refreshAllInformationEmbeds } from "../lib/information-embed.js";

const REFRESH_MS = 60_000;

export function startInformationEmbedUpdater(
  db: Database,
  rustPlus: RustPlusManager,
): void {
  const tick = async () => {
    try {
      const { configuredGuildId, resolveDiscordChannelId } = await import("../lib/discord-channels.js");
      const { ensureInformationEmbed } = await import("../lib/information-embed.js");
      const guildId = configuredGuildId();
      if (guildId) {
        const channelId = await resolveDiscordChannelId(db, guildId, "information");
        if (channelId) {
          await ensureInformationEmbed(db, rustPlus, guildId, channelId);
        }
      }
      await refreshAllInformationEmbeds(db, rustPlus);
    } catch (err) {
      console.error("[InformationEmbed] Periodic refresh failed:", err);
    }
  };

  setInterval(() => void tick(), REFRESH_MS);
  setTimeout(() => void tick(), 5_000);
}
