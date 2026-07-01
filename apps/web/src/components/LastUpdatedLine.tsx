import { formatDataAge } from "../lib/format-data-age";

export function LastUpdatedLine({
  fetchedAt,
  refreshing,
  className = "muted data-last-updated",
}: {
  fetchedAt: number | null;
  refreshing?: boolean;
  className?: string;
}) {
  if (fetchedAt == null) return null;

  return (
    <p className={className}>
      Last updated {formatDataAge(fetchedAt)}
      {refreshing ? " · refreshing…" : ""}
    </p>
  );
}
