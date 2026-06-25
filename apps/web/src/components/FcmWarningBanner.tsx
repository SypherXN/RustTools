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
    ? "FCM credentials are missing. Pairing and smart alarms will not work until you run fcm-register."
    : status.expired
      ? "FCM credentials have expired. Re-run fcm-register and restart the API."
      : `FCM credentials expire in ${status.daysRemaining ?? 0} day(s) (${status.expiresAt ? new Date(status.expiresAt).toLocaleDateString() : "unknown"}). Re-register soon to avoid losing pairing.`;

  return (
    <div className={`fcm-warning-banner fcm-warning-banner--${severity}`}>
      <strong>FCM credentials:</strong> {message}
    </div>
  );
}
