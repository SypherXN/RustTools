import fs from "node:fs";
import RustPlus from "@liamcottle/rustplus.js";
import type { EntityType, RustPlusEvent } from "@rusttools/shared";
import { EventBus } from "./event-bus.js";
import { FcmListener, type FcmConfig, type ParsedFcmNotification } from "./fcm-listener.js";
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
}

const BASE_RECONNECT_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 5 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAP_REQUEST_TIMEOUT_MS = 90_000;
/** Serve last good Rust+ reads for up to 30 minutes when the socket is slow. */
const STALE_READ_MAX_MS = 30 * 60 * 1000;

/** Avoid hammering Rust+ when the UI and background jobs request the same data. */
const READ_CACHE_TTL_MS = {
  serverInfo: 60_000,
  // Keep team positions and map event markers fresh enough to feel "live" on
  // the map while still de-duplicating bursts of concurrent requests.
  teamInfo: 10_000,
  mapMarkers: 15_000,
  map: 300_000,
  time: 30_000,
  teamChat: 30_000,
} as const;

/** Short TTL for entity reads — list endpoints hit many entities at once. */
const ENTITY_INFO_CACHE_TTL_MS = 8_000;

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
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err != null && "error" in err
        ? String((err as { error?: unknown }).error ?? "")
        : "";

  if (/timeout/i.test(message)) {
    return (
      "Camera subscribe timed out. Check the camera ID, confirm the server owner ran " +
      "`cctvrender.enabled true` in the server console, and make sure no one else is viewing that camera in-game."
    );
  }

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

  const fallback = normalizeRustPlusError(err, "Camera subscribe failed").message;
  return fallback === "Camera subscribe failed"
    ? `${fallback} (no details from server — CCTV may be disabled; try \`cctvrender.enabled true\` on the server).`
    : fallback;
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

function isRetriableRustError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return lower.includes("rate limit") || lower.includes("timed out");
}

async function withRustRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetriableRustError(err) || attempt === maxAttempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      console.warn(`[RustPlus] ${label} failed — retry ${attempt + 2}/${maxAttempts}`);
    }
  }
  throw lastErr;
}

export class RustPlusManager {
  readonly eventBus = new EventBus();
  readonly jobScheduler = new JobScheduler();
  readonly notifications: NotificationService;

  private connections = new Map<string, ActiveConnection>();
  private fcmListener: FcmListener | null = null;
  private fcmListening = false;
  private fcmNotificationHandler: ((notification: ParsedFcmNotification) => void) | null = null;
  private activeServerId: string | null = null;
  private lastMapMarkers: unknown = null;
  private readCache = new Map<ReadCacheKey, { at: number; value: unknown }>();
  private readInflight = new Map<ReadCacheKey, Promise<unknown>>();
  private entityInfoCache = new Map<number, { at: number; value: unknown }>();
  /** Rust+ websocket handles one request poorly when several are in flight. */
  private rustQueue: Array<{ priority: number; run: () => Promise<void> }> = [];
  private rustQueueDraining = false;
  /** Keep credentials so reconnect works after the socket entry is torn down. */
  private storedCredentials = new Map<string, ServerCredentials>();
  private subscribedEntitiesByServer = new Map<string, Set<number>>();
  private reconnectAttemptsByServer = new Map<string, number>();
  private reconnectTimersByServer = new Map<string, ReturnType<typeof setTimeout>>();
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private options: RustPlusManagerOptions = {}) {
    this.notifications = options.notificationService ?? new NotificationService();
  }

  getStatus() {
    const connected =
      this.activeServerId != null && this.connections.has(this.activeServerId);
    return {
      connected,
      reconnectPending: this.storedCredentials.size > 0 && !connected,
      activeServerId: this.activeServerId,
      fcmListening: this.fcmListening,
      serverCount: this.connections.size,
    };
  }

  /** Periodically retry when the bot should be connected but the socket dropped. */
  startConnectionWatchdog(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => {
      for (const serverId of this.storedCredentials.keys()) {
        if (this.connections.has(serverId) || this.reconnectTimersByServer.has(serverId)) {
          continue;
        }
        console.warn(`[RustPlus] Watchdog reconnecting to ${serverId}…`);
        this.reconnectAttemptsByServer.set(serverId, 0);
        this.scheduleReconnect(serverId);
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  stopConnectionWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
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

  private getStaleRead(key: ReadCacheKey): unknown | null {
    const cached = this.readCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.at > STALE_READ_MAX_MS) return null;
    return cached.value;
  }

  private enqueueRustRequest<T>(fn: () => Promise<T>, priority = 10): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.rustQueue.push({
        priority,
        run: async () => {
          try {
            resolve(await fn());
          } catch (err) {
            reject(err);
          }
        },
      });
      this.rustQueue.sort((a, b) => b.priority - a.priority);
      void this.drainRustQueue();
    });
  }

  /** Device subscribe/read — lower priority so team/map/info stay responsive. */
  private enqueueEntityRustRequest<T>(fn: () => Promise<T>): Promise<T> {
    return this.enqueueRustRequest(fn, 1);
  }

  private async drainRustQueue(): Promise<void> {
    if (this.rustQueueDraining) return;
    this.rustQueueDraining = true;
    while (this.rustQueue.length > 0) {
      const task = this.rustQueue.shift()!;
      await task.run();
    }
    this.rustQueueDraining = false;
  }

  private clearRustQueue(): void {
    this.rustQueue = [];
    this.rustQueueDraining = false;
  }

  private async cachedReadWithStale<T>(
    key: ReadCacheKey,
    fetch: () => Promise<T>,
    isUsable: (value: T) => boolean = () => true,
  ): Promise<T> {
    try {
      return await this.cachedRead(key, fetch);
    } catch (err) {
      const stale = this.getStaleRead(key) as T | null;
      if (stale != null && isUsable(stale)) {
        console.warn(
          `[RustPlus] ${key} failed — serving stale cache:`,
          err instanceof Error ? err.message : err,
        );
        return stale;
      }
      throw err;
    }
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
      await this.disconnectServer(credentials.id, { dropCredentials: false });
    }

    this.storedCredentials.set(credentials.id, credentials);
    if (!this.subscribedEntitiesByServer.has(credentials.id)) {
      this.subscribedEntitiesByServer.set(credentials.id, new Set());
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
      this.entityInfoCache.clear();
      this.clearRustQueue();
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
      subscribedEntities: this.subscribedEntitiesByServer.get(credentials.id)!,
    });

    this.reconnectAttemptsByServer.set(credentials.id, 0);
    const pendingTimer = this.reconnectTimersByServer.get(credentials.id);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.reconnectTimersByServer.delete(credentials.id);
    }

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
        if (payload.payload != null) {
          this.entityInfoCache.set(payload.entityId, {
            at: Date.now(),
            value: payload.payload,
          });
        }
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
      this.readCache.delete("teamChat");
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
    if (!this.storedCredentials.has(serverId)) return;

    const existingTimer = this.reconnectTimersByServer.get(serverId);
    if (existingTimer) clearTimeout(existingTimer);

    const attempts = this.reconnectAttemptsByServer.get(serverId) ?? 0;
    const delay = Math.min(BASE_RECONNECT_MS * 2 ** Math.min(attempts, 8), MAX_RECONNECT_DELAY_MS);
    this.reconnectAttemptsByServer.set(serverId, attempts + 1);

    const timer = setTimeout(() => {
      this.reconnectTimersByServer.delete(serverId);
      void this.reconnectServer(serverId).catch((err) => {
        console.error(`[RustPlus] Reconnect failed for ${serverId}:`, err);
        this.scheduleReconnect(serverId);
      });
    }, delay);

    this.reconnectTimersByServer.set(serverId, timer);
  }

  private async reconnectServer(serverId: string): Promise<void> {
    const credentials = this.storedCredentials.get(serverId);
    if (!credentials) return;

    const oldConn = this.connections.get(serverId);
    if (oldConn) {
      oldConn.client.disconnect();
      this.connections.delete(serverId);
    }

    await this.connectServer(credentials);
    const newConn = this.connections.get(serverId);
    if (!newConn) return;

    const entityIds = [...newConn.subscribedEntities];
    newConn.subscribedEntities.clear();
    for (const entityId of entityIds) {
      try {
        await this.subscribeEntity(entityId);
      } catch (err) {
        console.error(`[RustPlus] Failed to re-subscribe entity ${entityId}:`, err);
      }
    }
  }

  async disconnectServer(
    serverId: string,
    opts?: { dropCredentials?: boolean },
  ): Promise<void> {
    const conn = this.connections.get(serverId);
    const timer = this.reconnectTimersByServer.get(serverId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimersByServer.delete(serverId);
    }
    this.reconnectAttemptsByServer.delete(serverId);
    if (opts?.dropCredentials !== false) {
      this.storedCredentials.delete(serverId);
      this.subscribedEntitiesByServer.delete(serverId);
    }
    if (!conn) return;
    conn.client.disconnect();
    this.connections.delete(serverId);
    if (this.activeServerId === serverId) {
      this.activeServerId = this.connections.keys().next().value ?? null;
    }
  }

  async disconnectAll(): Promise<void> {
    this.stopConnectionWatchdog();
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

    await this.enqueueEntityRustRequest(() => {
      const activeConn = this.getActiveConnection();
      if (activeConn.subscribedEntities.has(entityId)) return Promise.resolve();
      return withRustRetry("subscribeEntity", () =>
        withRustTimeout(
          "subscribeEntity",
          (cb) => activeConn.client.getEntityInfo(entityId, cb),
          (m) => {
            const entityInfo = m.response?.entityInfo;
            if (entityInfo != null) {
              this.entityInfoCache.set(entityId, { at: Date.now(), value: entityInfo });
            }
            activeConn.subscribedEntities.add(entityId);
          },
        ),
      );
    });
  }

  async getEntityInfo(entityId: number): Promise<unknown> {
    const cached = this.readEntityInfoCache(entityId);
    if (cached != null) return cached;

    await this.subscribeEntity(entityId);

    const afterSubscribe = this.readEntityInfoCache(entityId);
    if (afterSubscribe != null) return afterSubscribe;

    const info = await this.enqueueEntityRustRequest(() => {
      const conn = this.getActiveConnection();
      return withRustRetry("getEntityInfo", () =>
        withRustTimeout(
          "getEntityInfo",
          (cb) => conn.client.getEntityInfo(entityId, cb),
          (m) => m.response?.entityInfo,
        ),
      );
    });
    if (info != null) {
      this.entityInfoCache.set(entityId, { at: Date.now(), value: info });
    }
    return info;
  }

  private readEntityInfoCache(entityId: number): unknown | null {
    const cached = this.entityInfoCache.get(entityId);
    if (cached && Date.now() - cached.at < ENTITY_INFO_CACHE_TTL_MS) {
      return cached.value;
    }
    return null;
  }

  invalidateEntityInfoCache(entityId?: number): void {
    if (entityId != null) {
      this.entityInfoCache.delete(entityId);
      return;
    }
    this.entityInfoCache.clear();
  }

  async toggleSwitch(entityId: number, value: boolean): Promise<void> {
    await this.subscribeEntity(entityId);

    await this.enqueueEntityRustRequest(() => {
      const conn = this.getActiveConnection();
      return withRustRetry("setEntityValue", () =>
        withRustTimeout(
          "setEntityValue",
          (cb) => conn.client.setEntityValue(entityId, value, cb),
          () => undefined,
        ),
      );
    });
    this.entityInfoCache.delete(entityId);
  }

  async toggleSwitchGroup(name: string, value: boolean): Promise<number> {
    // Group toggling is handled at API layer using DB entity list
    void name;
    void value;
    return 0;
  }

  async getServerInfo(): Promise<unknown> {
    return this.cachedReadWithStale("serverInfo", async () => {
      const conn = this.getActiveConnection();
      return this.enqueueRustRequest(() =>
        withRustRetry("getInfo", () =>
          withRustTimeout("getInfo", (cb) => conn.client.getInfo(cb), (m) => m.response?.info),
        ),
      );
    });
  }

  async getTeamInfo(): Promise<unknown> {
    return this.cachedReadWithStale("teamInfo", async () => {
      const conn = this.getActiveConnection();
      return this.enqueueRustRequest(() =>
        withRustRetry("getTeamInfo", () =>
          withRustTimeout(
            "getTeamInfo",
            (cb) => conn.client.getTeamInfo(cb),
            (m) => m.response?.teamInfo,
          ),
        ),
      );
    });
  }

  async getTeamChat(): Promise<unknown[]> {
    return this.cachedReadWithStale("teamChat", async () => {
      const conn = this.getActiveConnection();
      type RequestClient = {
        sendRequest: (
          data: { getTeamChat: Record<string, never> },
          callback: (message: RustPlusMessage) => boolean | void,
        ) => void;
      };
      return this.enqueueRustRequest(() =>
        withRustRetry("getTeamChat", () =>
          withRustTimeout(
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
          ),
        ),
      );
    });
  }

  async getTime(): Promise<unknown> {
    return this.cachedReadWithStale("time", async () => {
      const conn = this.getActiveConnection();
      return this.enqueueRustRequest(() =>
        withRustRetry("getTime", () =>
          withRustTimeout("getTime", (cb) => conn.client.getTime(cb), (m) => m.response?.time),
        ),
      );
    });
  }

  async getMap(): Promise<CachedMap> {
    return this.cachedReadWithStale(
      "map",
      async () => {
        const conn = this.getActiveConnection();
        const map = await this.enqueueRustRequest(() =>
          withRustRetry("getMap", () =>
            withRustTimeout(
              "getMap",
              (cb) => conn.client.getMap(cb),
              (m) => m.response?.map,
              MAP_REQUEST_TIMEOUT_MS,
            ),
          ),
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
      },
      (map) => map.width != null && map.jpgImage != null,
    );
  }

  async getMapMarkers(): Promise<unknown> {
    const markers = await this.cachedReadWithStale("mapMarkers", async () => {
      const conn = this.getActiveConnection();
      return this.enqueueRustRequest(() =>
        withRustRetry("getMapMarkers", () =>
          withRustTimeout(
            "getMapMarkers",
            (cb) => conn.client.getMapMarkers(cb),
            (m) => m.response?.mapMarkers,
          ),
        ),
      );
    });
    this.lastMapMarkers = markers;
    this.emitMapMarkersEvent(markers);
    return markers;
  }

  async sendTeamMessage(message: string): Promise<void> {
    await this.enqueueRustRequest(() => {
      const conn = this.getActiveConnection();
      return withRustRetry("sendTeamMessage", () =>
        withRustTimeout(
          "sendTeamMessage",
          (cb) => conn.client.sendTeamMessage(message, cb),
          () => undefined,
        ),
      );
    });
  }

  async promoteToLeader(steamId: string): Promise<void> {
    const conn = this.getActiveConnection();
    await this.promoteOnClient(conn.client, steamId);
  }

  async promoteToLeaderWithCredentials(
    credentials: Pick<ServerCredentials, "ip" | "port" | "playerId" | "playerToken">,
    targetSteamId: string,
  ): Promise<void> {
    const client = new RustPlus(
      credentials.ip,
      credentials.port,
      credentials.playerId,
      Number.parseInt(String(credentials.playerToken), 10),
    );

    try {
      await this.waitForConnection(client);
      await this.promoteOnClient(client, targetSteamId);
    } finally {
      try {
        client.disconnect();
      } catch {
        // ignore cleanup errors
      }
    }
  }

  private promoteOnClient(
    client: InstanceType<typeof RustPlus>,
    steamId: string,
  ): Promise<void> {
    type RequestClient = {
      sendRequest: (
        data: { promoteToLeader: { steamId: string } },
        callback: (message: RustPlusMessage) => boolean | void,
      ) => void;
    };
    return new Promise((resolve, reject) => {
      (client as unknown as RequestClient).sendRequest(
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
    this.fcmNotificationHandler = this.options.onFcmNotification ?? onNotification;
    if (this.options.fcmConfigPath) {
      void this.ensureFcmStarted().catch((err) => {
        console.error("[RustPlusManager] FCM listener failed:", err);
      });
    }
  }

  async reloadFcmListener(options?: {
    configPath?: string;
    config?: Record<string, unknown>;
  }): Promise<void> {
    this.stopFcmListener();
    const configPath = options?.configPath ?? this.options.fcmConfigPath;
    const inlineConfig = options?.config;
    if (!this.fcmNotificationHandler) return;
    if (!inlineConfig && (!configPath || !fs.existsSync(configPath))) return;

    this.fcmListener = new FcmListener(configPath ?? null, this.fcmNotificationHandler);
    try {
      if (inlineConfig) {
        await this.fcmListener.startFromConfig(inlineConfig as FcmConfig);
      } else {
        await this.fcmListener.start();
      }
      this.fcmListening = true;
    } catch (err) {
      this.fcmListening = false;
      throw err;
    }
  }

  private async ensureFcmStarted(): Promise<void> {
    await this.reloadFcmListener();
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
