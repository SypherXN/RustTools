export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordButtonComponent {
  type: 2;
  style: number;
  label: string;
  custom_id: string;
}

export interface DiscordActionRow {
  type: 1;
  components: DiscordButtonComponent[];
}

export interface DiscordNotification {
  channelId: string;
  content?: string;
  embed?: {
    title?: string;
    description?: string;
    color?: number;
    fields?: DiscordEmbedField[];
  };
  components?: DiscordActionRow[];
}

export interface WebSocketNotification {
  userId?: string;
  event: string;
  payload: unknown;
}

/** Plain callback object for Discord + WebSocket fan-out. */
export interface NotificationService {
  discord: (notification: DiscordNotification) => Promise<void>;
  webSocket: (notification: WebSocketNotification) => void;
}

export function createNotificationService(
  handlers: Partial<NotificationService> = {},
): NotificationService {
  return {
    async discord(notification) {
      if (!handlers.discord) {
        console.warn("[notifications] Discord handler not configured");
        return;
      }
      await handlers.discord(notification);
    },
    webSocket(notification) {
      handlers.webSocket?.(notification);
    },
  };
}
