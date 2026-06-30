import { and, eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { rustEntities } from "@rusttools/db";
import type { RustPlusManager, NotificationService } from "@rusttools/rustplus-client";
import {
  formatTcDecayAlertMessage,
  parseStorageEntityInfo,
  buildDiscordPingContent,
} from "@rusttools/shared";
import { getEntitySettings, updateEntitySettings } from "./entity-settings.js";
import { resolveDefaultGuildChannelId } from "./discord-channels.js";
import { getServerNotificationSettings } from "./server-notification-settings.js";
import { sendTeamChatIfUnmuted } from "./team-chat-outbound.js";

export async function evaluateTcDecayAlerts(
  db: Database,
  rustPlus: RustPlusManager,
  notifications: NotificationService,
  serverId: string,
): Promise<void> {
  const settings = await getServerNotificationSettings(db, serverId);
  const { tcDecay } = settings;
  if (!tcDecay.discord && !tcDecay.teamChat) return;

  const monitors = await db
    .select()
    .from(rustEntities)
    .where(and(eq(rustEntities.serverId, serverId), eq(rustEntities.entityType, "storage_monitor")));

  for (const monitor of monitors) {
    let parsed;
    try {
      const info = await rustPlus.getEntityInfo(monitor.entityId);
      parsed = parseStorageEntityInfo(info);
    } catch {
      continue;
    }

    if (!parsed.isToolCupboard || !parsed.upkeep) continue;

    const hours = parsed.upkeep.secondsRemaining / 3600;
    let alertLevel: "warning" | "critical" | null = null;
    if (hours <= tcDecay.criticalHours) alertLevel = "critical";
    else if (hours <= tcDecay.warningHours) alertLevel = "warning";

    const entitySettings = await getEntitySettings(db, monitor.id);
    const lastAlert = entitySettings.storage?.lastUpkeepAlertLevel ?? null;

    if (!alertLevel) {
      if (lastAlert) {
        await updateEntitySettings(db, monitor.id, {
          storage: { lastUpkeepAlertLevel: null },
        });
      }
      continue;
    }

    if (lastAlert === alertLevel) continue;

    const tcName = monitor.displayName ?? monitor.name;
    const message = formatTcDecayAlertMessage(tcName, parsed.upkeep.label, alertLevel);

    if (tcDecay.discord) {
      const channel = await resolveDefaultGuildChannelId(db, "storage");
      if (channel) {
        await notifications.discord({
          channelId: channel,
          content: buildDiscordPingContent(message, {
            pingEveryone: tcDecay.pingEveryone,
            pingRoleIds: tcDecay.pingRoleIds,
          }),
          embed: {
            title: alertLevel === "critical" ? "TC decay critical" : "TC decay warning",
            description: message,
            color: alertLevel === "critical" ? 0xf07178 : 0xe85d2a,
          },
        });
      }
    }

    if (tcDecay.teamChat) {
      await sendTeamChatIfUnmuted(db, rustPlus, serverId, message);
    }

    await updateEntitySettings(db, monitor.id, {
      storage: { lastUpkeepAlertLevel: alertLevel },
    });
  }
}
