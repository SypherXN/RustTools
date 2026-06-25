import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities, storageSnapshots } from "@rusttools/db";
import type { RustPlusManager, NotificationService } from "@rusttools/rustplus-client";
import { parseStorageEntityInfo } from "@rusttools/shared";
import { generateId } from "../lib/ids.js";
import { getWorldSize, parseTeamRoster, getActiveServer } from "../lib/rust-data.js";
import { processTeamRoster, enrichTeamApiResponse } from "../lib/team-tracker.js";
import { handleTeamRosterEvents } from "../lib/team-event-store.js";
import { recordTeamChatMessage } from "../lib/team-chat-buffer.js";
import { executeTeamChatCommand } from "../lib/team-chat-command-handler.js";
import { sendTeamChatCommandResult, sendTeamChatIfUnmuted } from "../lib/team-chat-outbound.js";
import {
  parseMuteTeamChatCommand,
  parseUnmuteTeamChatCommand,
} from "@rusttools/shared";
import {
  configuredWorldEventEntities,
  eventDiscordEnabled,
  eventTeamChatEnabled,
  worldEventAnnouncementEnabled,
} from "../lib/map-events.js";
import { mapEventAlertsEnabled } from "@rusttools/shared";
import {
  formatAnnouncementsForChat,
  worldEventTracker,
} from "../lib/world-event-tracker.js";
import { parseMonuments } from "../lib/map-markers.js";
import {
  getServerNotificationSettings,
  resolveDiscordAlarmChannelId,
} from "../lib/server-notification-settings.js";
import { resolveDefaultGuildChannelId } from "../lib/discord-channels.js";
import { deepSeaTracker, monumentsFromMap } from "../lib/deep-sea-tracker.js";
import {
  formatDeepSeaDiscordDescription,
  formatDeepSeaTeamChatMessage,
  formatSmartAlarmTeamChatMessage,
  formatWorldEventAnnouncement,
} from "@rusttools/shared";
import { getEntitySettings, updateEntitySettings } from "../lib/entity-settings.js";
import { recycleFromEntityInfo } from "../lib/vending.js";
import { buildStorageChangeDiscordPayload } from "../lib/storage-discord-embed.js";
import { evaluateSwitchAutoModes } from "../lib/switch-auto-modes.js";
import { evaluateTcDecayAlerts } from "../lib/tc-decay-monitor.js";
import { dispatchAlarmEscalation } from "../lib/alarm-escalation.js";
import { broadcastWebPush } from "../lib/web-push.js";
import {
  dispatchAutomationEvent,
  evaluateIntervalAutomationRules,
  evaluateScheduleWindowAutomationRules,
  evaluateTeamPresenceAutomationRules,
  evaluateTimeOfDayAutomationRules,
} from "../lib/automation-engine.js";
import { restorePendingSwitchJobs } from "../lib/switch-scheduler.js";

export function startPhase2Listeners(
  db: Database,
  rustPlus: RustPlusManager,
  notifications: NotificationService,
): void {
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
        const parsed = parseStorageEntityInfo(info);
        const recycle = recycleFromEntityInfo(info);
        const channel = await resolveDefaultGuildChannelId(db, "storage");
        if (channel) {
          const payload = buildStorageChangeDiscordPayload({
            monitorName: entity.displayName ?? entity.name,
            entityDbId: entity.id,
            items: parsed.items,
            recycle,
            isToolCupboard: parsed.isToolCupboard,
            upkeepLabel: parsed.upkeep?.label ?? null,
          });
          await notifications.discord({
            channelId: channel,
            embed: payload.embed,
            components: payload.components as Parameters<
              NotificationService["discord"]
            >[0]["components"],
          });
        }
        notifications.webSocket({
          event: "storageChanged",
          payload: { entityId: entity.id, name: entity.name },
        });

        const activeServer = await getActiveServer(db);
        if (activeServer) {
          if (parsed.isToolCupboard && parsed.upkeep) {
            void dispatchAutomationEvent(db, rustPlus, notifications, activeServer.id, "tc_upkeep_low", {
              entityId: entity.id,
              upkeepHours: parsed.upkeep.secondsRemaining / 3600,
            });
          }
          void dispatchAutomationEvent(db, rustPlus, notifications, activeServer.id, "storage_changed", {
            entityId: entity.id,
          });
        }
      }
    } catch {
      // entity may be unavailable
    }
  });

  rustPlus.eventBus.on("fcmAlarm", async (event) => {
    const activeServer = await getActiveServer(db);
    if (!activeServer) {
      notifications.webSocket({ event: "fcmAlarm", payload: event });
      return;
    }

    const settings = await getServerNotificationSettings(db, activeServer.id);
    notifications.webSocket({
      event: "fcmAlarm",
      payload: {
        ...event,
        browserSiren: settings.smartAlarm.browserSiren,
      },
    });

    const bodyEntityId = Number(
      (event.body?.entityId as string | number | undefined) ??
        (event.body?.id as string | number | undefined),
    );
    let matchedEntity: typeof rustEntities.$inferSelect | null = null;
    if (!Number.isNaN(bodyEntityId)) {
      const [row] = await db
        .select()
        .from(rustEntities)
        .where(eq(rustEntities.entityId, bodyEntityId))
        .limit(1);
      matchedEntity = row ?? null;
    }

    const entitySettings = matchedEntity
      ? await getEntitySettings(db, matchedEntity.id)
      : null;
    const customMessage = entitySettings?.alarm?.customMessage ?? null;
    const entityName = matchedEntity?.displayName ?? matchedEntity?.name ?? null;
    const pingEveryone =
      entitySettings?.alarm?.pingEveryone === true || settings.smartAlarm.pingEveryone;

    if (matchedEntity) {
      await updateEntitySettings(db, matchedEntity.id, {
        alarm: { lastTriggeredAt: Date.now() },
      });
    }

    const alarmText =
      customMessage?.trim() ||
      event.message?.trim() ||
      event.title?.trim() ||
      "Smart Alarm triggered!";
    const alarmTitle = entityName ? `Raid Alert — ${entityName}` : (event.title ?? "Raid Alert");

    if (settings.smartAlarm.discord) {
      const channel = await resolveDiscordAlarmChannelId(db);
      if (channel) {
        await notifications.discord({
          channelId: channel,
          content: pingEveryone ? `@everyone ${alarmText}` : alarmText,
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
        await sendTeamChatIfUnmuted(
          db,
          rustPlus,
          activeServer.id,
          formatSmartAlarmTeamChatMessage(event, customMessage, entityName),
        );
      } catch (err) {
        console.error("[SmartAlarm] Failed to send team chat:", err);
      }
    }

    if (settings.smartAlarm.webPush) {
      void broadcastWebPush(db, {
        title: alarmTitle,
        body: alarmText,
        url: "/",
      }).catch((err) => {
        console.error("[SmartAlarm] Web push failed:", err);
      });
    }

    if (settings.smartAlarm.escalation.enabled) {
      void dispatchAlarmEscalation(
        settings.smartAlarm.escalation.smsNumbers,
        settings.smartAlarm.escalation.emailAddresses,
        alarmTitle,
        alarmText,
      );
    }

    if (matchedEntity) {
      void dispatchAutomationEvent(db, rustPlus, notifications, activeServer.id, "smart_alarm", {
        entityId: matchedEntity.id,
      });
    }
  });

  rustPlus.eventBus.on("mapMarkers", (event) => {
    void (async () => {
      try {
        const activeServer = await getActiveServer(db);
        if (!activeServer) return;

        const cachedInfo = rustPlus.getCachedServerInfo();
        const cachedMap = rustPlus.getCachedMap();
        const info = cachedInfo ?? (await rustPlus.getServerInfo());
        const map = cachedMap ?? (await rustPlus.getMap());
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
            void sendTeamChatIfUnmuted(
              db,
              rustPlus,
              activeServer.id,
              formatDeepSeaTeamChatMessage(status),
            ).catch((err) => {
              console.error("[DeepSea] Failed to send team chat:", err);
            });
          }
        }

        const notificationSettings = await getServerNotificationSettings(db, activeServer.id);
        const { status: worldEvents, announcements } = await worldEventTracker.process(
          db,
          activeServer.id,
          {
            markersRaw: event.markers,
            monuments: parseMonuments(map).map((monument) => ({
              token: monument.token,
              x: monument.x,
              y: monument.y,
            })),
            worldSize,
            timers: notificationSettings.eventTimers,
          },
        );

        notifications.webSocket({ event: "worldEventsChanged", payload: worldEvents });

        const mapEventSettings = notificationSettings.legacyAutomations.mapEvents;
        if (mapEventAlertsEnabled(mapEventSettings)) {
          const enabledEntities = configuredWorldEventEntities(mapEventSettings);
          const discordChannel = await resolveDefaultGuildChannelId(db, "events");
          const sendDiscord = eventDiscordEnabled(mapEventSettings) && Boolean(discordChannel);
          const sendTeamChat = eventTeamChatEnabled(mapEventSettings);
          const filtered = announcements.filter((item) =>
            worldEventAnnouncementEnabled(item, enabledEntities),
          );
          const chatMessages = formatAnnouncementsForChat(
            filtered,
            worldSize,
            mapEventSettings.prefix,
          );

          for (const announcement of filtered) {
            if (sendDiscord) {
              void notifications.discord({
                channelId: discordChannel,
                embed: {
                  title: "World event",
                  description: formatWorldEventAnnouncement(
                    announcement,
                    worldSize,
                    mapEventSettings.prefix,
                  ),
                  color: announcement.kind === "heli_down" ? 0xe85d2a : 0x3dd68c,
                },
              });
            }
          }

          if (sendTeamChat) {
            for (const message of chatMessages) {
              void sendTeamChatIfUnmuted(db, rustPlus, activeServer.id, message).catch((err) => {
                console.error("[WorldEvents] Failed to send team chat:", err);
              });
            }
          }
        }
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

    try {
      const result = await executeTeamChatCommand(db, rustPlus, {
        serverId: event.serverId,
        senderSteamId: event.steamId,
        senderName: event.name,
        message: event.message,
      });
      if (result) {
        const force =
          parseMuteTeamChatCommand(event.message) ||
          parseUnmuteTeamChatCommand(event.message);
        await sendTeamChatCommandResult(db, rustPlus, event.serverId, result, force);
      }
    } catch (err) {
      console.error("[TeamChat] Failed to process command:", err);
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

const lastAllOfflineByServer = new Map<string, boolean>();

  rustPlus.eventBus.on("teamChanged", async (event) => {
    try {
      const [info, activeServer] = await Promise.all([
        rustPlus.getServerInfo(),
        getActiveServer(db),
      ]);
      const worldSize = getWorldSize(info);
      const parsed = parseTeamRoster(event.teamInfo, worldSize);
      const { team, deaths, newDeaths, newConnections } = processTeamRoster(
        event.serverId,
        parsed,
        worldSize,
      );
      await handleTeamRosterEvents(db, notifications, event.serverId, newDeaths, newConnections);
      notifications.webSocket({
        event: "teamChanged",
        payload: enrichTeamApiResponse(activeServer?.playerId ?? null, team, deaths),
      });
      if (activeServer && newConnections.length > 0) {
        void dispatchAutomationEvent(
          db,
          rustPlus,
          notifications,
          activeServer.id,
          "team_online_change",
          {},
        );
      }
      if (activeServer) {
        const allOffline = team.members.every((m) => !m.isOnline);
        const wasOffline = lastAllOfflineByServer.get(activeServer.id) ?? false;
        if (allOffline && !wasOffline) {
          void dispatchAutomationEvent(
            db,
            rustPlus,
            notifications,
            activeServer.id,
            "team_all_offline_change",
            {},
          );
        }
        lastAllOfflineByServer.set(activeServer.id, allOffline);
        void evaluateTeamPresenceAutomationRules(db, rustPlus, notifications, activeServer.id);
      }
    } catch {
      notifications.webSocket({ event: "teamChanged", payload: null });
    }
  });

  rustPlus.startMapMarkerPolling(90_000);

  rustPlus.jobScheduler.register({
    id: "night-lights",
    intervalMs: 120_000,
    run: async () => {
      try {
        const activeServer = await getActiveServer(db);
        if (!activeServer) return;
        const settings = await getServerNotificationSettings(db, activeServer.id);
        const nl = settings.legacyAutomations.nightLights;
        if (!nl.enabled || nl.entityIds.length === 0) return;

        const time = (await rustPlus.getTime()) as { isDay?: boolean };
        const turnOn = time.isDay === false;
        for (const id of nl.entityIds) {
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
      try {
        const activeServer = await getActiveServer(db);
        if (!activeServer) return;
        const settings = await getServerNotificationSettings(db, activeServer.id);
        const sam = settings.legacyAutomations.teamOfflineSam;
        if (!sam.enabled || sam.switchEntityId == null) return;

        const team = (await rustPlus.getTeamInfo()) as {
          members?: Array<{ isOnline?: boolean }>;
        };
        const allOffline = (team.members ?? []).every((m) => !m.isOnline);
        if (allOffline) {
          await rustPlus.toggleSwitch(sam.switchEntityId, true);
        }
      } catch {
        // ignore
      }
    },
  });

  rustPlus.jobScheduler.register({
    id: "schedule-window-automation",
    intervalMs: 60_000,
    run: async () => {
      const activeServer = await getActiveServer(db);
      if (!activeServer) return;
      try {
        await evaluateScheduleWindowAutomationRules(
          db,
          rustPlus,
          notifications,
          activeServer.id,
        );
      } catch (err) {
        console.error("[ScheduleWindow] Failed:", err);
      }
    },
  });

  rustPlus.jobScheduler.register({
    id: "switch-auto-modes",
    intervalMs: 120_000,
    run: async () => {
      const activeServer = await getActiveServer(db);
      if (!activeServer) return;
      try {
        await evaluateSwitchAutoModes(db, rustPlus, activeServer.id);
      } catch (err) {
        console.error("[SwitchAutoModes] Failed:", err);
      }
    },
  });

  let lastTcDecayPollAt = 0;

  rustPlus.jobScheduler.register({
    id: "tc-decay-monitor",
    intervalMs: 60_000,
    run: async () => {
      const activeServer = await getActiveServer(db);
      if (!activeServer) return;
      const settings = await getServerNotificationSettings(db, activeServer.id);
      const pollMs = settings.tcDecay.pollIntervalMinutes * 60_000;
      if (Date.now() - lastTcDecayPollAt < pollMs) return;
      lastTcDecayPollAt = Date.now();
      try {
        await evaluateTcDecayAlerts(db, rustPlus, notifications, activeServer.id);
      } catch (err) {
        console.error("[TcDecay] Failed:", err);
      }
    },
  });

  rustPlus.jobScheduler.register({
    id: "automation-interval",
    intervalMs: 60_000,
    run: async () => {
      const activeServer = await getActiveServer(db);
      if (!activeServer) return;
      try {
        await evaluateIntervalAutomationRules(db, rustPlus, notifications, activeServer.id);
        await evaluateTeamPresenceAutomationRules(db, rustPlus, notifications, activeServer.id);
        const time = (await rustPlus.getTime()) as { isDay?: boolean };
        await evaluateTimeOfDayAutomationRules(
          db,
          rustPlus,
          notifications,
          activeServer.id,
          time.isDay !== false,
        );
      } catch {
        // disconnected
      }
    },
  });

  void getActiveServer(db).then((server) => {
    if (server) {
      void restorePendingSwitchJobs(db, rustPlus, server.id);
    }
  });
}
