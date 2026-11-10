import {
  FCM_CREDENTIAL_LIFETIME_DAYS,
  FCM_WARNING_DAYS_BEFORE,
  type CompanionAuth,
  type CompanionAuthStatus,
  type FcmCredentialStatus,
} from "@rusttools/shared";
import type { FcmConfig } from "./fcm-listener.js";

export { FCM_CREDENTIAL_LIFETIME_DAYS, FCM_WARNING_DAYS_BEFORE };
export type { FcmCredentialStatus };

const DAY_MS = 24 * 60 * 60 * 1000;
const COMPANION_WARNING_DAYS = 3;
const COMPANION_MAX_LIFETIME_MS = 14 * DAY_MS;
const COMPANION_FUTURE_TOLERANCE_MS = 10 * 60 * 1000;
const COMPANION_TOKEN_MIN_LENGTH = 8;
const COMPANION_TOKEN_MAX_LENGTH = 4096;
const UINT64_MAX = 18446744073709551615n;
const UINT64_PATTERN = /^[1-9][0-9]*$/;
const STEAM_ID_PATTERN = /^[0-9]{17}$/;
const TOKEN_PATTERN = /^[\x21-\x7e]+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeUint64(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== "string" || !UINT64_PATTERN.test(value)) return null;
  try {
    const parsed = BigInt(value);
    return parsed > 0n && parsed <= UINT64_MAX ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function validateCompanionValue(
  value: unknown,
  now: number,
  requireUnexpired: boolean,
): { auth: CompanionAuth } | { error: string } {
  if (!isPlainObject(value)) return { error: "Companion auth configuration is invalid" };

  const { authToken, steamId, issuedAt, expiresAt } = value;
  if (
    typeof authToken !== "string" ||
    authToken.length < COMPANION_TOKEN_MIN_LENGTH ||
    authToken.length > COMPANION_TOKEN_MAX_LENGTH ||
    !TOKEN_PATTERN.test(authToken)
  ) {
    return { error: "Companion auth token is invalid" };
  }
  if (typeof steamId !== "string" || !STEAM_ID_PATTERN.test(steamId)) {
    return { error: "Companion auth Steam ID must be 17 digits" };
  }
  if (typeof issuedAt !== "string" || typeof expiresAt !== "string") {
    return { error: "Companion auth timestamps are invalid" };
  }
  const issuedMs = Date.parse(issuedAt);
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs) || expiresMs <= issuedMs) {
    return { error: "Companion auth timestamps are invalid" };
  }
  if (expiresMs - issuedMs > COMPANION_MAX_LIFETIME_MS) {
    return { error: "Companion auth lifetime exceeds 14 days" };
  }
  if (issuedMs > now + COMPANION_FUTURE_TOLERANCE_MS) {
    return { error: "Companion auth issue time is invalid" };
  }
  if (requireUnexpired && expiresMs <= now) {
    return { error: "Companion Rust+ auth has expired. Import fresh companion auth." };
  }
  return { auth: { authToken, steamId, issuedAt, expiresAt } };
}

export function getCompanionAuth(
  config: FcmConfig,
  expectedPlayerId?: string,
  now = Date.now(),
): CompanionAuth {
  const value = isPlainObject(config) ? (config as Record<string, unknown>).companion : undefined;
  if (value == null) {
    throw new Error("No companion Rust+ auth is configured. Import a companion auth config.");
  }
  const checked = validateCompanionValue(value, now, true);
  if ("error" in checked) throw new Error(checked.error);
  if (expectedPlayerId !== undefined && checked.auth.steamId !== String(expectedPlayerId).trim()) {
    throw new Error("Companion Rust+ auth Steam ID does not match this player.");
  }
  return { ...checked.auth };
}

export function computeCompanionAuthStatus(config: FcmConfig): CompanionAuthStatus {
  const value = isPlainObject(config) ? (config as Record<string, unknown>).companion : undefined;
  if (!isPlainObject(value)) {
    return {
      configured: false,
      steamId: null,
      issuedAt: null,
      expiresAt: null,
      daysRemaining: null,
      expired: false,
      warning: false,
    };
  }
  const steamId = typeof value.steamId === "string" ? value.steamId : null;
  const issuedAt = typeof value.issuedAt === "string" ? value.issuedAt : null;
  const expiresAt = typeof value.expiresAt === "string" ? value.expiresAt : null;
  const issuedMs = issuedAt === null ? NaN : Date.parse(issuedAt);
  const expiresMs = expiresAt === null ? NaN : Date.parse(expiresAt);
  const valid = Number.isFinite(issuedMs) && Number.isFinite(expiresMs) && expiresMs > issuedMs;
  const daysRemaining = valid ? Math.ceil((expiresMs - Date.now()) / DAY_MS) : null;
  const expired = valid && expiresMs <= Date.now();
  return {
    configured: true,
    steamId,
    issuedAt,
    expiresAt,
    daysRemaining,
    expired,
    warning: daysRemaining === null ? true : daysRemaining <= COMPANION_WARNING_DAYS,
  };
}

export function computeFcmCredentialStatus(
  registeredAtMs: number,
  listening: boolean,
  configured = true,
): FcmCredentialStatus {
  const expiresAtMs =
    registeredAtMs + FCM_CREDENTIAL_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
  const daysRemaining = Math.ceil((expiresAtMs - Date.now()) / (24 * 60 * 60 * 1000));

  return {
    configured,
    listening,
    registeredAt: new Date(registeredAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    daysRemaining,
    warning: daysRemaining <= FCM_WARNING_DAYS_BEFORE,
    expired: daysRemaining <= 0,
  };
}

export function validateFcmConfigPayload(
  data: unknown,
): { ok: true; config: Record<string, unknown> } | { ok: false; error: string } {
  if (!isPlainObject(data)) {
    return { ok: false, error: "Config must be a JSON object" };
  }

  const config = data;
  const creds = config.fcm_credentials;
  if (!isPlainObject(creds)) {
    return {
      ok: false,
      error:
        "Missing fcm_credentials object (use the canonical lowercase JSON; PascalCase/native JSON is not supported)",
    };
  }

  const gcm = creds.gcm;
  if (!isPlainObject(gcm)) {
    return { ok: false, error: "Missing fcm_credentials.gcm object" };
  }

  const androidId = normalizeUint64(gcm.androidId ?? gcm.android_id);
  const securityToken = normalizeUint64(gcm.securityToken ?? gcm.security_token);
  if (androidId === null) {
    return { ok: false, error: "GCM androidId must be a positive uint64 decimal string or safe integer" };
  }
  if (securityToken === null) {
    return { ok: false, error: "GCM securityToken must be a positive uint64 decimal string or safe integer" };
  }

  if (config.companion != null) {
    const checked = validateCompanionValue(config.companion, Date.now(), false);
    if ("error" in checked) return { ok: false, error: checked.error };
  }

  return {
    ok: true,
    config: {
      ...config,
      fcm_credentials: {
        ...creds,
        gcm: { ...gcm, androidId, securityToken },
      },
    },
  };
}

export function prepareFcmConfigForSave(
  config: Record<string, unknown>,
  options?: { replace?: boolean },
): Record<string, unknown> {
  const prepared = { ...config };
  if (options?.replace) {
    prepared.registered_at = new Date().toISOString();
    delete prepared.registeredAt;
  } else if (prepared.registered_at == null && prepared.registeredAt == null) {
    prepared.registered_at = new Date().toISOString();
  }
  return prepared;
}
