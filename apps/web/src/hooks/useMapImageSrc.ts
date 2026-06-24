import { useMemo } from "react";

/** Stable data URL — avoids blob revoke races (StrictMode) and per-render string churn. */
export function useMapImageSrc(base64: string | null | undefined): string | null {
  return useMemo(() => {
    if (!base64) return null;
    return `data:image/jpeg;base64,${base64}`;
  }, [base64]);
}
