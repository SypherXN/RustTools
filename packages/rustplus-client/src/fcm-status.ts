import fs from "node:fs";
import path from "node:path";

/** GCM push credentials from rustplus.js typically need refresh after ~90 days. */
export const FCM_CREDENTIAL_LIFETIME_DAYS = 90;
export const FCM_WARNING_DAYS_BEFORE = 14;

export interface FcmCredentialStatus {
  configured: boolean;
  listening: boolean;
  registeredAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  warning: boolean;
  expired: boolean;
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
