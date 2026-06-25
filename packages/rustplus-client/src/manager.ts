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
const REQUEST_TIMEOUT_MS = 15_000;
const MAP_REQUEST_TIMEOUT_MS = 60_000;

/** Avoid hammering Rust+ when the UI and background jobs request the same data. */
const READ_CACHE_TTL_MS = {
  serverInfo: 20_000,
  teamInfo: 15_000,
  mapMarkers: 15_000,
  map: 120_000,
  time: 15_000,
} as const;

type ReadCacheKey = keyof typeof READ_CACHE_TTL_MS;

type CachedMap = {
  jpgImage?: Buffer;
  width?: number;
  height?: number;
  oceanMargin?: number;
  monuments?: Array<{ token?: string; x?: number; y?: number }>;
};

type RustPlusMessage = {
  response?: {
    error?: { error?: string };
    info?: unknown;
    teamInfo?: unknown;
    time?: unknown;
    map?: unknown;
    mapMarkers?: unknown;
    entityInfo?: unknown;
  };
};

function extractRustPlusErrorCode(err: unknown): string | null {
  if (typeof err === "string" && err.length > 0) return err;
  if (err instanceof Error && err.message.length > 0) return err.message;
  if (typeof err === "object" && err != null) {
    const direct = (err as { error?: unknown }).error;
    if (typeof direct === "string" && direct.length > 0) return direct;
    if (typeof direct === "object" && direct != null && "error" in direct) {
      const nested = (direct as { error?: unknown }).error;
      if (typeof nested === "string" && nested.length > 0) return nested;
    }
  }
  return null;
}

function normalizeRustPlusError(err: unknown, fallback: string): Error {
  const code = extractRustPlusErrorCode(err);
  if (code?.toLowerCase() === "rate_limit") {
    return new Error("Rust+ rate limit hit — wait a few seconds and try again.");
  }
  if (code) return new Error(code);
  return new Error(fallback);
}

/** Turn Rust+ camera subscribe errors into actionable UI text. */
export function formatCameraSubscribeError(err: unknown): string {
  const code = extractRustPlusErrorCode(err)?.toLowerCase() ?? "";

  if (code === "not_found") {
    return (
      "Camera not found. Check the ID, confirm the monument exists on this map, or ask the server owner to run " +
      "`cctvrender.enabled true` in the server console (CCTV streaming is off by default on most servers)."
    );
  }
  if (code === "busy" || code === "occupied" || code === "in_use") {
    return "That camera is already in use (in-game or another Rust+ client). Disconnect the other viewer first.";
  }
  if (code === "rate_limit") {
    return "Rust+ rate limit hit — wait a few seconds and try again.";
  }
  if (code.includes("disabled") || code.includes("cctv")) {
    return (
      "CCTV streaming is disabled on this server. The owner must run `cctvrender.enabled true` in the server console."
    );
  }

  const message = normalizeRustPlusError(err, "Camera subscribe failed").message;
  return message === "Camera subscribe failed"
    ? `${message} (no details from server — CCTV may be disabled; try \`cctvrender.enabled true\` on the server).`
    : message;
}

function withRustTimeout<T>(
  label: string,
  send: (callback: (message: RustPlusMessage) => void) => void,
  pick: (message: RustPlusMessage) => T,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, timeoutMs);

    send((message) => {
      clearTimeout(timer);
      if (message.response?.error) {
        reject(normalizeRustPlusError(message.response.error.error, `${label} failed`));
        return;
      }
      resolve(pick(message));
    });
  });
}

export class RustPlusManager {
  readonly eventBus = new EventBus();
  readonly jobScheduler = new JobScheduler();
  readonly notifications: NotificationService;

  private connections = new Map<string, ActiveConnection>();
  private fcmListener: FcmListener | null = null;
  private fcmListening = false;
  private activeServerId: string | null = null;
  private lastMapMarkers: unknown = null;
  private readCache = new Map<ReadCacheKey, { at: number; value: unknown }>();
  private readInflight = new Map<ReadCacheKey, Promise<unknown>>();

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

  getCachedServerInfo(): unknown | null {
    return (this.readCache.get("serverInfo")?.value as unknown | undefined) ?? null;
  }

  getCachedMap(): CachedMap | null {
    return (this.readCache.get("map")?.value as CachedMap | undefined) ?? null;
  }

  private cachedRead<T>(key: ReadCacheKey, fetch: () => Promise<T>): Promise<T> {
    const ttl = READ_CACHE_TTL_MS[key];
    const cached = this.readCache.get(key);
    if (cached && Date.now() - cached.at < ttl) {
      return Promise.resolve(cached.value as T);
    }

    const inflight = this.readInflight.get(key);
    if (inflight) return inflight as Promise<T>;

    const promise = fetch()
      .then((value) => {
        this.readCache.set(key, { at: Date.now(), value });
        this.readInflight.delete(key);
        return value;
      })
      .catch((err) => {
        this.readInflight.delete(key);
        throw err;
      });
    this.readInflight.set(key, promise);
    return promise;
  }

  private emitMapMarkersEvent(markers: unknown): void {
    if (!this.activeServerId) return;
    // Defer so concurrent getMap/getServerInfo from the same HTTP handler populate cache first.
    queueMicrotask(() => {
      this.eventBus.emit({
        type: "mapMarkers",
        serverId: this.activeServerId!,
        markers,
      });
    });
  }

  async connectServer(credentials: ServerCredentials): Promise<void> {
    if (this.connections.has(credentials.id)) {
      await this.disconnectServer(credentials.id);
    }

    const client = new RustPlus(
      credentials.ip,
      credentials.port,
      credentials.playerId,
      Number.parseInt(String(credentials.playerToken), 10),
    );

    await this.waitForConnection(client);

    client.on("disconnected", () => {
      this.readCache.clear();
      this.readInflight.clear();
      this.lastMapMarkers = null;
      this.eventBus.emit({
        type: "connectionLost",
        serverId: credentials.id,
        reason: "disconnected",
      });
      this.scheduleReconnect(credentials.id);
    });

    client.on("error", (err: Error) => {
      console.error(`[RustPlus] WebSocket error (${credentials.name}):`, err.message);
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

    const wrapper = broadcast.teamMessage as
      | {
          message?: {
            steamId?: number | string;
            name?: string;
            message?: string;
            time?: number;
          };
        }
      | undefined;
    const teamMessage = wrapper?.message;
    if (teamMessage?.message) {
      this.eventBus.emit({
        type: "teamChat",
        serverId,
        message: teamMessage.message,
        steamId: String(teamMessage.steamId ?? ""),
        name: teamMessage.name?.trim() || "Unknown",
        sentAt: teamMessage.time ?? Math.floor(Date.now() / 1000),
      });
    }

    const teamChanged = broadcast.teamChanged as { teamInfo?: unknown } | undefined;
    if (teamChanged?.teamInfo) {
      this.eventBus.emit({
        type: "teamChanged",
        serverId,
        teamInfo: teamChanged.teamInfo,
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
    return this.cachedRead("serverInfo", async () => {
      const conn = this.getActiveConnection();
      return withRustTimeout("getInfo", (cb) => conn.client.getInfo(cb), (m) => m.response?.info);
    });
  }

  async getTeamInfo(): Promise<unknown> {
    return this.cachedRead("teamInfo", async () => {
      const conn = this.getActiveConnection();
      return withRustTimeout(
        "getTeamInfo",
        (cb) => conn.client.getTeamInfo(cb),
        (m) => m.response?.teamInfo,
      );
    });
  }

  async getTeamChat(): Promise<unknown[]> {
    const conn = this.getActiveConnection();
    type RequestClient = {
      sendRequest: (
        data: { getTeamChat: Record<string, never> },
        callback: (message: RustPlusMessage) => boolean | void,
      ) => void;
    };
    return withRustTimeout(
      "getTeamChat",
      (cb) => {
        (conn.client as unknown as RequestClient).sendRequest({ getTeamChat: {} }, (message) => {
          cb(message);
          return true;
        });
      },
      (m) => {
        const teamChat = (m.response as { teamChat?: { messages?: unknown[] } } | undefined)
          ?.teamChat;
        return teamChat?.messages ?? [];
      },
    );
  }

  async getTime(): Promise<unknown> {
    return this.cachedRead("time", async () => {
      const conn = this.getActiveConnection();
      return withRustTimeout("getTime", (cb) => conn.client.getTime(cb), (m) => m.response?.time);
    });
  }

  async getMap(): Promise<CachedMap> {
    return this.cachedRead("map", async () => {
      const conn = this.getActiveConnection();
      const map = await withRustTimeout(
        "getMap",
        (cb) => conn.client.getMap(cb),
        (m) => m.response?.map,
        MAP_REQUEST_TIMEOUT_MS,
      );
      const data = map as {
        jpgImage?: Uint8Array | Buffer;
        width?: number;
        height?: number;
        oceanMargin?: number;
        monuments?: Array<{ token?: string; x?: number; y?: number }>;
      };
      return {
        jpgImage: data?.jpgImage ? Buffer.from(data.jpgImage) : undefined,
        width: data?.width,
        height: data?.height,
        oceanMargin: data?.oceanMargin,
        monuments: data?.monuments,
      };
    });
  }

  async getMapMarkers(): Promise<unknown> {
    const markers = await this.cachedRead("mapMarkers", async () => {
      const conn = this.getActiveConnection();
      return withRustTimeout(
        "getMapMarkers",
        (cb) => conn.client.getMapMarkers(cb),
        (m) => m.response?.mapMarkers,
      );
    });
    this.lastMapMarkers = markers;
    this.emitMapMarkersEvent(markers);
    return markers;
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

  async promoteToLeader(steamId: string): Promise<void> {
    const conn = this.getActiveConnection();
    type RequestClient = {
      sendRequest: (
        data: { promoteToLeader: { steamId: string } },
        callback: (message: RustPlusMessage) => boolean | void,
      ) => void;
    };
    return new Promise((resolve, reject) => {
      (conn.client as unknown as RequestClient).sendRequest(
        { promoteToLeader: { steamId } },
        (response) => {
          if (response.response?.error) {
            reject(new Error(response.response.error.error ?? "promoteToLeader failed"));
            return true;
          }
          resolve();
          return true;
        },
      );
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

  private activeCamera: {
    cameraId: string;
    camera: import("@liamcottle/rustplus.js").RustPlusCamera;
    onRender?: (frame: Buffer) => void;
  } | null = null;

  getCameraStatus(): { active: boolean; cameraId: string | null; isAutoTurret: boolean } {
    return {
      active: this.activeCamera != null,
      cameraId: this.activeCamera?.cameraId ?? null,
      isAutoTurret: this.activeCamera?.camera.isAutoTurret() ?? false,
    };
  }

  async subscribeCamera(
    cameraId: string,
    onFrame: (frame: Buffer) => void,
  ): Promise<{ width?: number; height?: number; controlFlags?: number }> {
    await this.unsubscribeCamera();
    const conn = this.getActiveConnection();
    const camera = conn.client.getCamera(cameraId);
    this.activeCamera = { cameraId, camera, onRender: onFrame };

    camera.on("render", (frame: Buffer) => {
      this.activeCamera?.onRender?.(frame);
      this.eventBus.emit({
        type: "cameraFrame",
        serverId: this.activeServerId!,
        cameraId,
        frameBase64: frame.toString("base64"),
      });
    });

    try {
      await camera.subscribe();
    } catch (err) {
      this.activeCamera = null;
      const code = extractRustPlusErrorCode(err);
      console.error(`[RustPlus] Camera subscribe failed (${cameraId}):`, code ?? err);
      throw new Error(formatCameraSubscribeError(err));
    }

    const info = (camera as { cameraSubscribeInfo?: { width?: number; height?: number; controlFlags?: number } })
      .cameraSubscribeInfo;

    return {
      width: info?.width,
      height: info?.height,
      controlFlags: info?.controlFlags ?? (camera.isAutoTurret() ? 1 : 0),
    };
  }

  async unsubscribeCamera(): Promise<void> {
    if (!this.activeCamera) return;
    try {
      await this.activeCamera.camera.unsubscribe();
    } catch {
      // ignore
    }
    this.activeCamera = null;
  }

  async sendCameraInput(buttons: number, mouseDeltaX: number, mouseDeltaY: number): Promise<void> {
    if (!this.activeCamera) {
      throw new Error("No active camera subscription");
    }
    await this.activeCamera.camera.move(buttons, mouseDeltaX, mouseDeltaY);
  }

  async shootCamera(): Promise<void> {
    if (!this.activeCamera) {
      throw new Error("No active camera subscription");
    }
    if (!this.activeCamera.camera.isAutoTurret()) {
      throw new Error("Active camera is not an auto turret");
    }
    await this.activeCamera.camera.shoot();
  }
}

export type { RustPlusEvent, ParsedFcmNotification };
