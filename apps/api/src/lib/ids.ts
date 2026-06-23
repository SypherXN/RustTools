import { randomBytes } from "node:crypto";
import { nanoid } from "nanoid";

export function generateId(): string {
  return nanoid();
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}
