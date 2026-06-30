import { apiUrl } from "./api";
import { isDemoMode } from "./demo";

/** Fetch a protected image/binary from the API with session cookies. */
export async function fetchAuthenticatedBlob(path: string): Promise<Blob | null> {
  if (isDemoMode()) return null;

  const res = await fetch(apiUrl(path), { credentials: "include" });
  if (!res.ok) return null;
  return res.blob();
}
