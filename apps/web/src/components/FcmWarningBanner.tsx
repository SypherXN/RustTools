import { useEffect, useState } from "react";
import type { FcmCredentialStatus } from "@rusttools/shared";
import { apiFetch } from "../lib/api";
import { useCan } from "../hooks/usePermissions";
import { isDemoMode } from "../lib/demo";

export function FcmWarningBanner() {
  const canAdmin = useCan("admin");
  const [status, setStatus] = useState<FcmCredentialStatus | null>(null);

  useEffect(() => {
    if (!canAdmin || isDemoMode()) return;
    void apiFetch<FcmCredentialStatus>("/admin/fcm-status")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [canAdmin]);

  if (!canAdmin || !status) return null;

  const healthy =
    status.configured && status.listening && !status.warning && !status.expired;
  if (healthy) return null;

  const severity = !status.configured || status.expired ? "critical" : "warning";
  const message = !status.configured
    ? "FCM credentials are missing. Upload fcm-config.json in Settings → Admin or run fcm-register."
    : status.expired
      ? "FCM credentials have expired. Upload a new fcm-config.json in Settings → Admin or re-run fcm-register."
      : `FCM credentials expire in ${status.daysRemaining ?? 0} day(s) (${status.expiresAt ? new Date(status.expiresAt).toLocaleDateString() : "unknown"}). Re-register soon to avoid losing pairing.`;

  return (
    <div className={`fcm-warning-banner fcm-warning-banner--${severity}`} role="alert">
      <span>FCM credentials: {message}</span>
    </div>
  );
}
