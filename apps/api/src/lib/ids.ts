import { randomBytes, randomUUID } from "node:crypto";

export function generateId(): string {
  return randomUUID();
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}
