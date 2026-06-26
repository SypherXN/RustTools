import fs from "node:fs";
import path from "node:path";
import {
  FCM_CREDENTIAL_LIFETIME_DAYS,
  FCM_WARNING_DAYS_BEFORE,
} from "@rusttools/shared";

export { FCM_CREDENTIAL_LIFETIME_DAYS, FCM_WARNING_DAYS_BEFORE };

export interface FcmCredentialStatus {
  configured: boolean;
  listening: boolean;
  registeredAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  warning: boolean;
  expired: boolean;
}

export function validateFcmConfigPayload(
  data: unknown,
): { ok: true; config: Record<string, unknown> } | { ok: false; error: string } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "Config must be a JSON object" };
  }

  const config = data as Record<string, unknown>;
  const creds = config.fcm_credentials as Record<string, unknown> | undefined;
  if (!creds || typeof creds !== "object") {
    return { ok: false, error: "Missing fcm_credentials object" };
  }

  const gcm = creds.gcm as Record<string, unknown> | undefined;
  if (!gcm || typeof gcm !== "object") {
    return { ok: false, error: "Missing fcm_credentials.gcm object" };
  }

  const androidId = gcm.androidId ?? gcm.android_id;
  const securityToken = gcm.securityToken ?? gcm.security_token;
  if (!androidId || !securityToken) {
    return {
      ok: false,
      error: "Missing GCM androidId or securityToken — run fcm-register first",
    };
  }

  return { ok: true, config };
}

export function prepareFcmConfigForSave(config: Record<string, unknown>): Record<string, unknown> {
  const prepared = { ...config };
  if (prepared.registered_at == null && prepared.registeredAt == null) {
    prepared.registered_at = new Date().toISOString();
  }
  return prepared;
}

export function writeFcmConfigFile(configPath: string, config: Record<string, unknown>): void {
  const resolved = path.resolve(configPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const prepared = prepareFcmConfigForSave(config);
  fs.writeFileSync(resolved, `${JSON.stringify(prepared, null, 2)}\n`, "utf8");
}

export function getFcmCredentialStatus(
  configPath: string,
  listening: boolean,
): FcmCredentialStatus {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    return {
      configured: false,
      listening: false,
      registeredAt: null,
      expiresAt: null,
      daysRemaining: null,
      warning: true,
      expired: false,
    };
  }

  let registeredAtMs: number;
  try {
    const raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as {
      registered_at?: number | string;
      registeredAt?: number | string;
    };
    const fromConfig = raw.registered_at ?? raw.registeredAt;
    if (fromConfig != null) {
      registeredAtMs =
        typeof fromConfig === "number"
          ? fromConfig > 1e12
            ? fromConfig
            : fromConfig * 1000
          : Date.parse(fromConfig);
    } else {
      registeredAtMs = fs.statSync(resolved).mtimeMs;
    }
  } catch {
    registeredAtMs = fs.statSync(resolved).mtimeMs;
  }

  const expiresAtMs =
    registeredAtMs + FCM_CREDENTIAL_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
  const daysRemaining = Math.ceil((expiresAtMs - Date.now()) / (24 * 60 * 60 * 1000));

  return {
    configured: true,
    listening,
    registeredAt: new Date(registeredAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    daysRemaining,
    warning: daysRemaining <= FCM_WARNING_DAYS_BEFORE,
    expired: daysRemaining <= 0,
  };
}
