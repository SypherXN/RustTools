import fs from "node:fs";
import path from "node:path";
import PushReceiverClient from "@liamcottle/push-receiver/src/client.js";

export interface FcmConfig {
  fcm_credentials?: {
    gcm?: {
      androidId?: string;
      securityToken?: string;
      android_id?: string;
      security_token?: string;
    };
  };
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

export function parseFcmData(data: {
  appData?: Array<{ key: string; value: string }>;
}): ParsedFcmNotification | null {
  const appData = data.appData;
  if (!appData) return null;

  const get = (key: string) => appData.find((item) => item.key === key)?.value;
  const channelId = get("channelId");
  const bodyRaw = get("body");
  if (!channelId || !bodyRaw) return null;

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(bodyRaw) as Record<string, unknown>;
  } catch {
    return null;
  }

  return {
    channelId,
    title: get("title"),
    message: get("message"),
    body,
    playerId: body.playerId != null ? String(body.playerId) : undefined,
  };
}

export class FcmListener {
  private client: InstanceType<typeof PushReceiverClient> | null = null;

  constructor(
    private configPath: string,
    private onNotification: (notification: ParsedFcmNotification) => void,
  ) {}

  async start(): Promise<void> {
    const config = readFcmConfig(this.configPath);
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
