import {
  FCM_CREDENTIAL_LIFETIME_DAYS,
  FCM_WARNING_DAYS_BEFORE,
  type FcmCredentialStatus,
} from "@rusttools/shared";

export { FCM_CREDENTIAL_LIFETIME_DAYS, FCM_WARNING_DAYS_BEFORE };
export type { FcmCredentialStatus };

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
