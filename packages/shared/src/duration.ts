/** Compact elapsed duration: `45s`, `3m`, `1h 5m`, `2d 3h`. */
export function formatDurationCompact(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remM = minutes % 60;
  if (hours < 24) return remM > 0 ? `${hours}h ${remM}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
}
