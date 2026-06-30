import { useEffect, useState } from "react";
import { fetchAuthenticatedBlob } from "../lib/authenticated-media";

/** Load a credentialed API image as a blob URL (required when UI and API are on different origins). */
export function useAuthenticatedImageSrc(path: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setSrc(null);
      return;
    }

    let active = true;
    let blobUrl: string | null = null;

    void (async () => {
      const blob = await fetchAuthenticatedBlob(path).catch(() => null);
      if (!active || !blob) return;
      blobUrl = URL.createObjectURL(blob);
      setSrc(blobUrl);
    })();

    return () => {
      active = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setSrc(null);
    };
  }, [path]);

  return src;
}
