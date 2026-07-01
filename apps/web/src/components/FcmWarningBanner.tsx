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
    ? "No active FCM master. Open Settings → Admin and add a master account."
    : status.expired
      ? "Active FCM has expired. Settings → Admin → renew or switch to another master."
      : `Active FCM expires in ${status.daysRemaining ?? 0} day(s) (${status.expiresAt ? new Date(status.expiresAt).toLocaleDateString() : "unknown"}). Renew in Settings → Admin.`;

  return (
    <div className={`fcm-warning-banner fcm-warning-banner--${severity}`} role="alert">
      <span>FCM credentials: {message}</span>
    </div>
  );
}
