import fs from "node:fs";
import path from "node:path";
import PushReceiverClient from "@liamcottle/push-receiver/src/client.js";
import type { CompanionAuth } from "@rusttools/shared";

export interface FcmConfig {
  fcm_credentials?: {
    gcm?: {
      androidId?: string;
      securityToken?: string;
      android_id?: string;
      security_token?: string;
    };
  };
  /** Optional modern companion relay metadata; legacy FCM-only configs stay valid. */
  companion?: CompanionAuth;
}

export interface ParsedFcmNotification {
  channelId: string;
  title?: string;
  message?: string;
  body: Record<string, unknown>;
  playerId?: string;
}

function readFcmConfig(configPath: string): FcmConfig {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`FCM config not found: ${resolved}`);
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as FcmConfig;
}

export function parseFcmData(data: unknown): ParsedFcmNotification | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const appData = (data as { appData?: unknown }).appData;
  if (!Array.isArray(appData)) return null;

  const get = (key: string): string | undefined => {
    for (const item of appData) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const entry = item as { key?: unknown; value?: unknown };
      if (entry.key === key && typeof entry.value === "string") return entry.value;
    }
    return undefined;
  };
  const channelId = get("channelId");
  const bodyRaw = get("body");
  if (!channelId || !bodyRaw) return null;

  let body: unknown;
  try {
    body = JSON.parse(bodyRaw);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;

  const bodyRecord = body as Record<string, unknown>;
  return {
    channelId,
    title: get("title"),
    message: get("message"),
    body: bodyRecord,
    playerId: bodyRecord.playerId != null ? String(bodyRecord.playerId) : undefined,
  };
}

export class FcmListener {
  private client: InstanceType<typeof PushReceiverClient> | null = null;

  constructor(
    private configPath: string | null,
    private onNotification: (notification: ParsedFcmNotification) => void,
  ) {}

  async start(): Promise<void> {
    if (!this.configPath) {
      throw new Error("FCM config path not set");
    }
    const config = readFcmConfig(this.configPath);
    await this.startFromConfig(config);
  }

  async startFromConfig(config: FcmConfig): Promise<void> {
    const gcm = config.fcm_credentials?.gcm;
    const androidId = gcm?.androidId ?? gcm?.android_id;
    const securityToken = gcm?.securityToken ?? gcm?.security_token;

    if (!androidId || !securityToken) {
      throw new Error("FCM credentials missing in config. Run fcm-register first.");
    }

    this.client = new PushReceiverClient(androidId, securityToken, []);
    this.client.on("ON_DATA_RECEIVED", (data: { appData?: Array<{ key: string; value: string }> }) => {
      const parsed = parseFcmData(data);
      if (parsed) {
        this.onNotification(parsed);
      }
    });

    await this.client.connect();
    console.log("[FCM] Listening for pairing and alarm notifications");
  }

  stop(): void {
    if (this.client) {
      this.client.destroy?.();
      this.client = null;
    }
  }
}
