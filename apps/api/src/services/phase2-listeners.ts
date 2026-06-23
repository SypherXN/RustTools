import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities, storageSnapshots } from "@rusttools/db";
import type { RustPlusManager, NotificationService } from "@rusttools/rustplus-client";
import { generateId } from "../lib/ids.js";

const CHINOOK_TYPE = 8;
const CARGO_TYPE = 5;
const PATROL_HELI_TYPE = 7;

interface MapMarker {
  type?: number;
  name?: string;
  x?: number;
  y?: number;
}

const EVENT_LABELS: Record<number, string> = {
  [CHINOOK_TYPE]: "Chinook spotted",
  [CARGO_TYPE]: "Cargo ship active",
  [PATROL_HELI_TYPE]: "Patrol helicopter",
};

export function startPhase2Listeners(
  db: Database,
  rustPlus: RustPlusManager,
  notifications: NotificationService,
): void {
  const seenMarkerKeys = new Set<string>();
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
        const channel = process.env.DISCORD_NOTIFICATION_CHANNEL_ID ?? "";
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
    const channel = process.env.DISCORD_NOTIFICATION_CHANNEL_ID ?? "";
    if (!channel) return;

    await notifications.discord({
      channelId: channel,
      content: event.message ?? event.title ?? "Smart Alarm triggered!",
      embed: {
        title: event.title ?? "Raid Alert",
        description: event.message,
        color: 0xf07178,
      },
    });
  });

  rustPlus.eventBus.on("mapMarkers", (event) => {
    const markers = (event.markers as { markers?: MapMarker[] })?.markers ?? [];
    for (const marker of markers) {
      const label = marker.type != null ? EVENT_LABELS[marker.type] : undefined;
      if (!label) continue;

      const key = `${marker.type}:${marker.x}:${marker.y}`;
      if (seenMarkerKeys.has(key)) continue;
      seenMarkerKeys.add(key);

      const channel = process.env.DISCORD_NOTIFICATION_CHANNEL_ID ?? "";
      if (!channel) continue;

      void notifications.discord({
        channelId: channel,
        embed: {
          title: label,
          description: marker.name ?? "Check map for location",
          color: 0x3dd68c,
        },
      });
    }
  });

  rustPlus.eventBus.on("teamChat", async (event) => {
    notifications.webSocket({ event: "teamChat", payload: event });

    const channel =
      process.env.DISCORD_TEAM_CHAT_CHANNEL_ID ??
      process.env.DISCORD_NOTIFICATION_CHANNEL_ID ??
      "";
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
