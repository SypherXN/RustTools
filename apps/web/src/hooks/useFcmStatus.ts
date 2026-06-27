import { useEffect, useState } from "react";
import type { FcmCredentialStatus } from "@rusttools/shared";
import { apiFetch } from "../lib/api";
import { isDemoMode } from "../lib/demo";

let sharedStatus: FcmCredentialStatus | null = null;
let sharedPromise: Promise<FcmCredentialStatus | null> | null = null;

async function loadFcmStatus(): Promise<FcmCredentialStatus | null> {
  if (sharedPromise) return sharedPromise;
  sharedPromise = apiFetch<FcmCredentialStatus>("/admin/fcm-status")
    .then((status) => {
      sharedStatus = status;
      return status;
    })
    .catch(() => {
      sharedStatus = null;
      return null;
    })
    .finally(() => {
      sharedPromise = null;
    });
  return sharedPromise;
}

export function useFcmStatus(enabled: boolean): FcmCredentialStatus | null {
  const [status, setStatus] = useState<FcmCredentialStatus | null>(sharedStatus);

  useEffect(() => {
    if (!enabled || isDemoMode()) {
      setStatus(null);
      return;
    }
    if (sharedStatus) {
      setStatus(sharedStatus);
      return;
    }
    void loadFcmStatus().then(setStatus);
  }, [enabled]);

  return status;
}

export function invalidateFcmStatusCache(): void {
  sharedStatus = null;
  sharedPromise = null;
}
