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

export interface NotificationHandlers {
  discord?: (notification: DiscordNotification) => Promise<void>;
  webSocket?: (notification: WebSocketNotification) => void;
}

export class NotificationService {
  constructor(private handlers: NotificationHandlers = {}) {}

  setHandlers(handlers: NotificationHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  async discord(notification: DiscordNotification): Promise<void> {
    if (!this.handlers.discord) {
      console.warn("[NotificationService] Discord handler not configured");
      return;
    }
    await this.handlers.discord(notification);
  }

  webSocket(notification: WebSocketNotification): void {
    if (!this.handlers.webSocket) {
      return;
    }
    this.handlers.webSocket(notification);
  }
}
