import RustPlus from "@liamcottle/rustplus.js";
import type { EntityType, RustPlusEvent } from "@rusttools/shared";
import { EventBus } from "./event-bus.js";
import { FcmListener, type ParsedFcmNotification } from "./fcm-listener.js";
import { JobScheduler } from "./job-scheduler.js";
import { NotificationService } from "./notification-service.js";

export interface ServerCredentials {
  id: string;
  ip: string;
  port: number;
  playerId: string;
  playerToken: string;
  name: string;
}

export interface EntityPairingPayload {
  serverId: string;
  entityId: number;
  entityType: EntityType;
  name: string;
}

export interface RustPlusManagerOptions {
  fcmConfigPath?: string;
  notificationService?: NotificationService;
  onFcmNotification?: (notification: ParsedFcmNotification) => void;
}

interface ActiveConnection {
  credentials: ServerCredentials;
  client: InstanceType<typeof RustPlus>;
  subscribedEntities: Set<number>;
  reconnectAttempts: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_MS = 5000;

export class RustPlusManager {
  readonly eventBus = new EventBus();
  readonly jobScheduler = new JobScheduler();
  readonly notifications: NotificationService;

  private connections = new Map<string, ActiveConnection>();
  private fcmListener: FcmListener | null = null;
  private fcmListening = false;
  private activeServerId: string | null = null;
  private lastMapMarkers: unknown = null;

  constructor(private options: RustPlusManagerOptions = {}) {
    this.notifications = options.notificationService ?? new NotificationService();
  }

  getStatus() {
    return {
      connected: this.connections.size > 0,
      activeServerId: this.activeServerId,
      fcmListening: this.fcmListening,
      serverCount: this.connections.size,
    };
  }

  getLastMapMarkers(): unknown {
    return this.lastMapMarkers;
  }

  async connectServer(credentials: ServerCredentials): Promise<void> {
    if (this.connections.has(credentials.id)) {
      await this.disconnectServer(credentials.id);
    }

    const client = new RustPlus(
      credentials.ip,
      credentials.port,
      credentials.playerId,
      credentials.playerToken,
    );

    await this.waitForConnection(client);

    client.on("disconnected", () => {
      this.eventBus.emit({
        type: "connectionLost",
        serverId: credentials.id,
        reason: "disconnected",
      });
      this.scheduleReconnect(credentials.id);
    });

    client.on("message", (message: { broadcast?: Record<string, unknown> }) => {
      this.handleClientMessage(credentials.id, message);
    });

    this.connections.set(credentials.id, {
      credentials,
      client,
      subscribedEntities: new Set(),
      reconnectAttempts: 0,
    });

    if (!this.activeServerId) {
      this.activeServerId = credentials.id;
    }

    this.eventBus.emit({ type: "connectionRestored", serverId: credentials.id });
  }

  private waitForConnection(client: InstanceType<typeof RustPlus>): Promise<void> {
    return new Promise((resolve, reject) => {
      const onConnected = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        client.removeListener("connected", onConnected);
        client.removeListener("error", onError);
      };
      client.on("connected", onConnected);
      client.on("error", onError);
      client.connect();
    });
  }

  private handleClientMessage(
    serverId: string,
    message: { broadcast?: Record<string, unknown> },
  ): void {
    const broadcast = message.broadcast;
    if (!broadcast) return;

    if (broadcast.entityChanged) {
      const payload = broadcast.entityChanged as { entityId?: number; payload?: unknown };
      if (payload.entityId != null) {
        this.eventBus.emit({
          type: "entityChanged",
          serverId,
          entityId: payload.entityId,
          payload: payload.payload,
        });
      }
    }

    const teamMessage = broadcast.teamMessage as { message?: string; userId?: string } | undefined;
    if (teamMessage?.message) {
      this.eventBus.emit({
        type: "teamChat",
        serverId,
        message: teamMessage.message,
        steamId: String(teamMessage.userId ?? ""),
      });
    }
  }

  private scheduleReconnect(serverId: string): void {
    const conn = this.connections.get(serverId);
    if (!conn) return;

    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
    }

    if (conn.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[RustPlus] Max reconnect attempts reached for ${serverId}`);
      return;
    }

    const delay = BASE_RECONNECT_MS * 2 ** conn.reconnectAttempts;
    conn.reconnectAttempts += 1;

    conn.reconnectTimer = setTimeout(() => {
      void this.reconnectServer(serverId).catch((err) => {
        console.error(`[RustPlus] Reconnect failed for ${serverId}:`, err);
        this.scheduleReconnect(serverId);
      });
    }, delay);
  }

  private async reconnectServer(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;

    const { credentials, subscribedEntities } = conn;
    conn.client.disconnect();
    this.connections.delete(serverId);

    await this.connectServer(credentials);
    const newConn = this.connections.get(serverId);
    if (!newConn) return;

    newConn.reconnectAttempts = 0;
    for (const entityId of subscribedEntities) {
      await this.subscribeEntity(entityId);
    }
  }

  async disconnectServer(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
    conn.client.disconnect();
    this.connections.delete(serverId);
    if (this.activeServerId === serverId) {
      this.activeServerId = this.connections.keys().next().value ?? null;
    }
  }

  async disconnectAll(): Promise<void> {
    this.stopFcmListener();
    for (const serverId of [...this.connections.keys()]) {
      await this.disconnectServer(serverId);
    }
    this.jobScheduler.stopAll();
  }

  setActiveServer(serverId: string): void {
    if (!this.connections.has(serverId)) {
      throw new Error(`Server ${serverId} is not connected`);
    }
    this.activeServerId = serverId;
  }

  private getActiveConnection(): ActiveConnection {
    if (!this.activeServerId) {
      throw new Error("No active Rust+ server connection");
    }
    const conn = this.connections.get(this.activeServerId);
    if (!conn) {
      throw new Error("Active server connection not found");
    }
    return conn;
  }

  async subscribeEntity(entityId: number): Promise<void> {
    const conn = this.getActiveConnection();
    if (conn.subscribedEntities.has(entityId)) return;

    await new Promise<void>((resolve, reject) => {
      conn.client.getEntityInfo(entityId, (message) => {
        if (message.response?.error) {
          reject(new Error(message.response.error.error ?? "getEntityInfo failed"));
          return;
        }
        conn.subscribedEntities.add(entityId);
        resolve();
      });
    });
  }

  async getEntityInfo(entityId: number): Promise<unknown> {
    await this.subscribeEntity(entityId);
    const conn = this.getActiveConnection();
    return new Promise((resolve, reject) => {
      conn.client.getEntityInfo(entityId, (message) => {
        if (message.response?.error) {
          reject(new Error(message.response.error.error ?? "getEntityInfo failed"));
          return;
        }
        resolve(message.response?.entityInfo);
      });
    });
  }

  async toggleSwitch(entityId: number, value: boolean): Promise<void> {
    const conn = this.getActiveConnection();
    await this.subscribeEntity(entityId);

    await new Promise<void>((resolve, reject) => {
      conn.client.setEntityValue(entityId, value, (message) => {
        if (message.response?.error) {
          reject(new Error(message.response.error.error ?? "setEntityValue failed"));
          return;
        }
        resolve();
      });
    });
  }

  async toggleSwitchGroup(name: string, value: boolean): Promise<number> {
    // Group toggling is handled at API layer using DB entity list
    void name;
    void value;
    return 0;
  }

  async getServerInfo(): Promise<unknown> {
    const conn = this.getActiveConnection();
    return new Promise((resolve, reject) => {
      conn.client.getInfo((message) => {
        if (message.response?.error) {
          reject(new Error(message.response.error.error ?? "getInfo failed"));
          return;
        }
        resolve(message.response?.info);
      });
    });
  }

  async getTeamInfo(): Promise<unknown> {
    const conn = this.getActiveConnection();
    return new Promise((resolve, reject) => {
      conn.client.getTeamInfo((message) => {
        if (message.response?.error) {
          reject(new Error(message.response.error.error ?? "getTeamInfo failed"));
          return;
        }
        resolve(message.response?.teamInfo);
      });
    });
  }

  async getTime(): Promise<unknown> {
    const conn = this.getActiveConnection();
    return new Promise((resolve, reject) => {
      conn.client.getTime((message) => {
        if (message.response?.error) {
          reject(new Error(message.response.error.error ?? "getTime failed"));
          return;
        }
        resolve(message.response?.time);
      });
    });
  }

  async getMap(): Promise<{ jpgImage?: Buffer; width?: number; height?: number }> {
    const conn = this.getActiveConnection();
    return new Promise((resolve, reject) => {
      conn.client.getMap((message) => {
        if (message.response?.error) {
          reject(new Error(message.response.error.error ?? "getMap failed"));
          return;
        }
        const map = message.response?.map as {
          jpgImage?: Uint8Array | Buffer;
          width?: number;
          height?: number;
        };
        resolve({
          jpgImage: map?.jpgImage ? Buffer.from(map.jpgImage) : undefined,
          width: map?.width,
          height: map?.height,
        });
      });
    });
  }

  async getMapMarkers(): Promise<unknown> {
    const conn = this.getActiveConnection();
    return new Promise((resolve, reject) => {
      conn.client.getMapMarkers((message) => {
        if (message.response?.error) {
          reject(new Error(message.response.error.error ?? "getMapMarkers failed"));
          return;
        }
        const markers = message.response?.mapMarkers;
        this.lastMapMarkers = markers;
        if (this.activeServerId) {
          this.eventBus.emit({
            type: "mapMarkers",
            serverId: this.activeServerId,
            markers,
          });
        }
        resolve(markers);
      });
    });
  }

  async sendTeamMessage(message: string): Promise<void> {
    const conn = this.getActiveConnection();
    return new Promise((resolve, reject) => {
      conn.client.sendTeamMessage(message, (response) => {
        if (response.response?.error) {
          reject(new Error(response.response.error.error ?? "sendTeamMessage failed"));
          return;
        }
        resolve();
      });
    });
  }

  handleServerPaired(credentials: ServerCredentials): void {
    this.eventBus.emit({
      type: "serverPaired",
      serverId: credentials.id,
      name: credentials.name,
    });
  }

  handleEntityPaired(payload: EntityPairingPayload): void {
    this.eventBus.emit({
      type: "entityPaired",
      serverId: payload.serverId,
      entityId: payload.entityId,
      entityType: payload.entityType,
      name: payload.name,
    });
  }

  startFcmListener(onNotification: (notification: ParsedFcmNotification) => void): void {
    if (!this.options.fcmConfigPath) {
      console.warn("[RustPlusManager] FCM config path not set; pairing listener disabled");
      return;
    }

    const handler = this.options.onFcmNotification ?? onNotification;
    this.fcmListener = new FcmListener(this.options.fcmConfigPath, handler);

    void this.fcmListener.start().then(() => {
      this.fcmListening = true;
    }).catch((err) => {
      console.error("[RustPlusManager] FCM listener failed:", err);
      this.fcmListening = false;
    });
  }

  stopFcmListener(): void {
    this.fcmListener?.stop();
    this.fcmListener = null;
    this.fcmListening = false;
  }

  startMapMarkerPolling(intervalMs = 60_000): void {
    this.jobScheduler.register({
      id: "map-markers",
      intervalMs,
      run: async () => {
        if (!this.activeServerId) return;
        try {
          await this.getMapMarkers();
        } catch (err) {
          console.error("[RustPlus] Map marker poll failed:", err);
        }
      },
    });
  }
}

export type { RustPlusEvent, ParsedFcmNotification };
