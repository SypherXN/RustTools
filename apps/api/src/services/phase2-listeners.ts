import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities, storageSnapshots } from "@rusttools/db";
import type { RustPlusManager, NotificationService } from "@rusttools/rustplus-client";
import { generateId } from "../lib/ids.js";
import { getWorldSize, parseTeamRoster, getActiveServer } from "../lib/rust-data.js";
import { processTeamRoster, enrichTeamApiResponse } from "../lib/team-tracker.js";
import { recordTeamChatMessage } from "../lib/team-chat-buffer.js";
import {
  configuredMapEventTypes,
  eventDiscordDescription,
  eventDiscordEnabled,
  eventTeamChatEnabled,
  formatEventTeamChatMessage,
  mapEventAlertsEnabled,
  MapEventAnnouncer,
} from "../lib/map-events.js";
import {
  getServerNotificationSettings,
  resolveDiscordAlarmChannelId,
} from "../lib/server-notification-settings.js";
import { resolveDefaultGuildChannelId } from "../lib/discord-channels.js";
import { deepSeaTracker, monumentsFromMap } from "../lib/deep-sea-tracker.js";
import { fetchDeepSeaStatus } from "../lib/deep-sea.js";
import {
  formatDeepSeaDiscordDescription,
  formatDeepSeaTeamChatMessage,
  formatSmartAlarmTeamChatMessage,
  parseDeepSeaTeamChatCommand,
} from "@rusttools/shared";

export function startPhase2Listeners(
  db: Database,
  rustPlus: RustPlusManager,
  notifications: NotificationService,
): void {
  const mapEventAnnouncer = new MapEventAnnouncer();
  const lastStorageJson = new Map<string, string>();

  rustPlus.eventBus.on("entityChanged", async (event) => {
    notifications.webSocket({ event: "entityChanged", payload: event });

    const [entity] = await db
      .select()
      .from(rustEntities)
      .where(eq(rustEntities.entityId, event.entityId))
      .limit(1);

    if (!entity || entity.entityType !== "storage_monitor") return;

    try {
      const info = await rustPlus.getEntityInfo(event.entityId);
      const json = JSON.stringify(info);
      const prev = lastStorageJson.get(entity.id);
      lastStorageJson.set(entity.id, json);

      await db.insert(storageSnapshots).values({
        id: generateId(),
        entityId: entity.id,
        contentsJson: json,
        createdAt: new Date(),
      });

      if (prev && prev !== json) {
        const channel = await resolveDefaultGuildChannelId(db, "storage");
        if (channel) {
          await notifications.discord({
            channelId: channel,
            embed: {
              title: "Storage changed",
              description: `${entity.displayName ?? entity.name} contents updated`,
              color: 0xe85d2a,
            },
          });
        }
        notifications.webSocket({
          event: "storageChanged",
          payload: { entityId: entity.id, name: entity.name },
        });
      }
    } catch {
      // entity may be unavailable
    }
  });

  rustPlus.eventBus.on("fcmAlarm", async (event) => {
    notifications.webSocket({ event: "fcmAlarm", payload: event });

    const activeServer = await getActiveServer(db);
    if (!activeServer) return;

    const settings = await getServerNotificationSettings(db, activeServer.id);
    const alarmText = event.message ?? event.title ?? "Smart Alarm triggered!";
    const alarmTitle = event.title ?? "Raid Alert";

    if (settings.smartAlarm.discord) {
      const channel = await resolveDiscordAlarmChannelId(db);
      if (channel) {
        await notifications.discord({
          channelId: channel,
          content: alarmText,
          embed: {
            title: alarmTitle,
            description: alarmText,
            color: 0xf07178,
          },
        });
      }
    }

    if (settings.smartAlarm.teamChat) {
      try {
        await rustPlus.sendTeamMessage(formatSmartAlarmTeamChatMessage(event));
      } catch (err) {
        console.error("[SmartAlarm] Failed to send team chat:", err);
      }
    }
  });

  rustPlus.eventBus.on("mapMarkers", (event) => {
    void (async () => {
      try {
        const activeServer = await getActiveServer(db);
        if (!activeServer) return;

        const [info, map] = await Promise.all([rustPlus.getServerInfo(), rustPlus.getMap()]);
        const worldSize = getWorldSize(info) || 4000;
        const { status, transition } = deepSeaTracker.process(activeServer.id, {
          markersRaw: event.markers,
          monuments: monumentsFromMap(map),
          mapSize: worldSize,
        });

        notifications.webSocket({ event: "deepSeaChanged", payload: status });

        if (transition) {
          const settings = await getServerNotificationSettings(db, activeServer.id);
          const title = transition === "opened" ? "Deep Sea opened" : "Deep Sea closed";
          const color = transition === "opened" ? 0x3dd68c : 0xe85d2a;

          if (settings.deepSea.discord) {
            const channel = await resolveDefaultGuildChannelId(db, "deep_sea");
            if (channel) {
              void notifications.discord({
                channelId: channel,
                embed: {
                  title,
                  description: formatDeepSeaDiscordDescription(status),
                  color,
                },
              });
            }
          }

          if (settings.deepSea.teamChat) {
            void rustPlus
              .sendTeamMessage(formatDeepSeaTeamChatMessage(status))
              .catch((err) => {
                console.error("[DeepSea] Failed to send team chat:", err);
              });
          }
        }

        if (!mapEventAlertsEnabled()) return;

        const enabledTypes = configuredMapEventTypes();
        const discordChannel = await resolveDefaultGuildChannelId(db, "events");
        const sendDiscord = eventDiscordEnabled() && Boolean(discordChannel);
        const sendTeamChat = eventTeamChatEnabled();

        mapEventAnnouncer.processMarkers(event.markers, enabledTypes, (marker) => {
          if (sendDiscord) {
            void notifications.discord({
              channelId: discordChannel,
              embed: {
                title: `${marker.label} spotted`,
                description: eventDiscordDescription(marker, worldSize),
                color: 0x3dd68c,
              },
            });
          }

          if (sendTeamChat) {
            void rustPlus
              .sendTeamMessage(formatEventTeamChatMessage(marker, worldSize))
              .catch((err) => {
                console.error("[MapEvents] Failed to send team chat:", err);
              });
          }
        });
      } catch (err) {
        console.error("[MapEvents] Failed to process map markers:", err);
      }
    })();
  });

  rustPlus.eventBus.on("teamChat", async (event) => {
    recordTeamChatMessage(event.serverId, {
      steamId: event.steamId,
      name: event.name,
      message: event.message,
      sentAt: event.sentAt,
    });
    notifications.webSocket({ event: "teamChat", payload: event });

    if (parseDeepSeaTeamChatCommand(event.message)) {
      try {
        const status = await fetchDeepSeaStatus(db, rustPlus, event.serverId);
        await rustPlus.sendTeamMessage(formatDeepSeaTeamChatMessage(status));
      } catch (err) {
        console.error("[DeepSea] Failed to answer team chat command:", err);
      }
    }

    const channel = await resolveDefaultGuildChannelId(db, "team_chat");
    if (!channel) return;

    await notifications.discord({
      channelId: channel,
      embed: {
        title: "Team Chat",
        description: event.message,
        color: 0x5865f2,
      },
    });
  });

  rustPlus.eventBus.on("teamChanged", async (event) => {
    try {
      const [info, activeServer] = await Promise.all([
        rustPlus.getServerInfo(),
        getActiveServer(db),
      ]);
      const worldSize = getWorldSize(info);
      const parsed = parseTeamRoster(event.teamInfo, worldSize);
      const { team, deaths } = processTeamRoster(event.serverId, parsed, worldSize);
      notifications.webSocket({
        event: "teamChanged",
        payload: enrichTeamApiResponse(activeServer?.playerId ?? null, team, deaths),
      });
    } catch {
      notifications.webSocket({ event: "teamChanged", payload: null });
    }
  });

  rustPlus.startMapMarkerPolling(60_000);

  rustPlus.jobScheduler.register({
    id: "night-lights",
    intervalMs: 120_000,
    run: async () => {
      if (process.env.AUTOMATION_NIGHT_LIGHTS !== "true") return;
      try {
        const time = (await rustPlus.getTime()) as { isDay?: boolean };
        const turnOn = time.isDay === false;
        const ids = (process.env.AUTOMATION_NIGHT_LIGHT_ENTITY_IDS ?? "")
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => !Number.isNaN(n));
        for (const id of ids) {
          await rustPlus.toggleSwitch(id, turnOn);
        }
      } catch {
        // disconnected
      }
    },
  });

  rustPlus.jobScheduler.register({
    id: "team-offline-sam",
    intervalMs: 180_000,
    run: async () => {
      if (process.env.AUTOMATION_TEAM_OFFLINE_SAM !== "true") return;
      try {
        const team = (await rustPlus.getTeamInfo()) as {
          members?: Array<{ isOnline?: boolean }>;
        };
        const allOffline = (team.members ?? []).every((m) => !m.isOnline);
        const samId = Number(process.env.AUTOMATION_SAM_SWITCH_ENTITY_ID);
        if (!Number.isNaN(samId) && allOffline) {
          await rustPlus.toggleSwitch(samId, true);
        }
      } catch {
        // ignore
      }
    },
  });
}
