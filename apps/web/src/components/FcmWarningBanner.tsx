import { useCan } from "../hooks/usePermissions";
import { useFcmStatus } from "../hooks/useFcmStatus";

export function FcmWarningBanner() {
  const canAdmin = useCan("admin");
  const status = useFcmStatus(canAdmin);

  if (!canAdmin || !status) return null;

  const healthy =
    status.configured && status.listening && !status.warning && !status.expired;
  if (healthy) return null;

  const severity = !status.configured || status.expired ? "critical" : "warning";
  const message = !status.configured
    ? "FCM credentials are missing. Open Settings → Admin and follow the setup wizard."
    : status.expired
      ? "FCM credentials have expired. Settings → Admin → renew and upload a new fcm-config.json."
      : `FCM credentials expire in ${status.daysRemaining ?? 0} day(s) (${status.expiresAt ? new Date(status.expiresAt).toLocaleDateString() : "unknown"}). Re-register soon in Settings → Admin.`;

  return (
    <div className={`fcm-warning-banner fcm-warning-banner--${severity}`} role="alert">
      <span>FCM credentials: {message}</span>
    </div>
  );
}
