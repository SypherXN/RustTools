import { and, eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { discordLiveEmbeds } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import {
  formatDeepSeaDiscordDescription,
  parseServerMapMeta,
  worldToGridLabel,
} from "@rusttools/shared";
import { fetchDeepSeaStatus } from "./deep-sea.js";
import type { DiscordEmbedPayload } from "./discord-messages.js";
import { editDiscordMessage, postDiscordMessage } from "./discord-messages.js";
import {
  getActiveServer,
  getWorldSize,
  parseInGameTime,
  parseTeamRoster,
  parseWipeCountdown,
} from "./rust-data.js";

const INFORMATION_PURPOSE = "information";

async function getStoredEmbed(
  db: Database,
  guildId: string,
): Promise<{ channelId: string; messageId: string } | null> {
  const [row] = await db
    .select({
      channelId: discordLiveEmbeds.channelId,
      messageId: discordLiveEmbeds.messageId,
    })
    .from(discordLiveEmbeds)
    .where(
      and(
        eq(discordLiveEmbeds.guildId, guildId),
        eq(discordLiveEmbeds.purpose, INFORMATION_PURPOSE),
      ),
    )
    .limit(1);

  if (!row?.channelId || !row.messageId) return null;
  return row;
}

async function storeEmbed(
  db: Database,
  guildId: string,
  channelId: string,
  messageId: string,
): Promise<void> {
  const now = new Date();
  await db
    .insert(discordLiveEmbeds)
    .values({
      guildId,
      purpose: INFORMATION_PURPOSE,
      channelId,
      messageId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [discordLiveEmbeds.guildId, discordLiveEmbeds.purpose],
      set: { channelId, messageId, updatedAt: now },
    });
}

export async function buildInformationEmbed(
  db: Database,
  rustPlus: RustPlusManager,
): Promise<DiscordEmbedPayload> {
  const activeServer = await getActiveServer(db);
  const status = rustPlus.getStatus();

  if (!activeServer || !status.connected) {
    return {
      title: "RustTools — Server Information",
      description: "Rust+ is not connected. Pair a server in the web dashboard to populate this board.",
      color: 0xe85d2a,
      footer: { text: "RustTools" },
      timestamp: new Date().toISOString(),
    };
  }

  try {
    const [info, teamRaw, timeRaw, deepSea] = await Promise.all([
      rustPlus.getServerInfo(),
      rustPlus.getTeamInfo(),
      rustPlus.getTime(),
      fetchDeepSeaStatus(rustPlus, activeServer.id),
    ]);

    const mapMeta = parseServerMapMeta(info);
    const worldSize = getWorldSize(info);
    const team = parseTeamRoster(teamRaw, worldSize);
    const gameTime = parseInGameTime(timeRaw);
    const wipe = parseWipeCountdown(info);
    const infoData = info as {
      name?: string;
      players?: number;
      maxPlayers?: number;
      queuedPlayers?: number;
    };

    const online = team.members.filter((m) => m.isOnline);
    const teamLines = online.length
      ? online
          .slice(0, 8)
          .map((m) => {
            const grid =
              m.locationKnown && m.x != null && m.y != null && worldSize
                ? worldToGridLabel(m.x, m.y, worldSize)
                : null;
            const gridPart = grid ? ` @ ${grid}` : "";
            const life = m.isAlive === false ? " (dead)" : "";
            return `• ${m.name}${gridPart}${life}`;
          })
          .join("\n")
      : "_No teammates online_";

    return {
      title: infoData.name ?? "Rust Server",
      color: 0x5865f2,
      fields: [
        {
          name: "Population",
          value: [
            `**Players:** ${infoData.players ?? "?"} / ${infoData.maxPlayers ?? "?"}`,
            infoData.queuedPlayers ? `**Queue:** ${infoData.queuedPlayers}` : null,
            `**Wipe:** ${wipe.label}`,
          ]
            .filter(Boolean)
            .join("\n"),
          inline: true,
        },
        {
          name: "Map",
          value: [
            mapMeta.mapName ? `**Name:** ${mapMeta.mapName}` : null,
            mapMeta.seed != null ? `**Seed:** ${mapMeta.seed}` : null,
            mapMeta.mapSize ? `**Size:** ${mapMeta.mapSize}m` : null,
          ]
            .filter(Boolean)
            .join("\n") || "—",
          inline: true,
        },
        {
          name: "Time",
          value: gameTime.time
            ? `${gameTime.time} (${gameTime.isDay ? "day" : "night"})`
            : "—",
          inline: true,
        },
        {
          name: `Team (${online.length}/${team.members.length} online)`,
          value: teamLines.slice(0, 1024),
          inline: false,
        },
        {
          name: "Deep Sea",
          value: formatDeepSeaDiscordDescription(deepSea).slice(0, 1024),
          inline: false,
        },
      ],
      footer: { text: "RustTools · updates every minute" },
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load server data";
    return {
      title: "RustTools — Server Information",
      description: `Could not refresh: ${message}`,
      color: 0xe85d2a,
      footer: { text: "RustTools" },
      timestamp: new Date().toISOString(),
    };
  }
}

export async function syncInformationEmbed(
  db: Database,
  rustPlus: RustPlusManager,
  guildId: string,
  channelId: string,
): Promise<void> {
  const embed = await buildInformationEmbed(db, rustPlus);
  const stored = await getStoredEmbed(db, guildId);

  if (stored && stored.channelId === channelId) {
    try {
      await editDiscordMessage(channelId, stored.messageId, { embed });
      return;
    } catch {
      /* message deleted or channel changed — post a new one */
    }
  }

  const posted = await postDiscordMessage({ channelId, embed });
  if (!posted) return;
  await storeEmbed(db, guildId, channelId, posted.id);
}

export async function ensureInformationEmbed(
  db: Database,
  rustPlus: RustPlusManager,
  guildId: string,
  channelId: string,
): Promise<void> {
  await syncInformationEmbed(db, rustPlus, guildId, channelId);
}

export async function refreshAllInformationEmbeds(
  db: Database,
  rustPlus: RustPlusManager,
  skipGuildIds: Set<string> = new Set(),
): Promise<void> {
  const rows = await db
    .select({
      guildId: discordLiveEmbeds.guildId,
      channelId: discordLiveEmbeds.channelId,
    })
    .from(discordLiveEmbeds)
    .where(eq(discordLiveEmbeds.purpose, INFORMATION_PURPOSE));

  for (const row of rows) {
    if (skipGuildIds.has(row.guildId)) continue;
    try {
      await syncInformationEmbed(db, rustPlus, row.guildId, row.channelId);
    } catch (err) {
      console.error("[InformationEmbed] Refresh failed:", err);
    }
  }
}

export async function clearInformationEmbedBinding(
  db: Database,
  guildId: string,
): Promise<void> {
  await db
    .delete(discordLiveEmbeds)
    .where(
      and(
        eq(discordLiveEmbeds.guildId, guildId),
        eq(discordLiveEmbeds.purpose, INFORMATION_PURPOSE),
      ),
    );
}
