import fs from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { fcmCredentials, rustServers } from "@rusttools/db";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import {
  computeFcmCredentialStatus,
  prepareFcmConfigForSave,
  validateFcmConfigPayload,
} from "@rusttools/rustplus-client";
import type { FcmCredentialStatus, FcmCredentialSummary } from "@rusttools/shared";
import { env } from "../config.js";
import { logAudit } from "./audit.js";
import { decrypt, encrypt } from "./crypto.js";
import { generateId } from "./ids.js";
import { deleteRustServer } from "./rust-server-lifecycle.js";
import { reconnectRustServer } from "../services/rustplus-bootstrap.js";

function parseRegisteredAtFromConfig(config: Record<string, unknown>): Date {
  const raw = config.registered_at ?? config.registeredAt;
  if (raw == null) return new Date();
  if (typeof raw === "number") {
    return new Date(raw > 1e12 ? raw : raw * 1000);
  }
  const parsed = Date.parse(String(raw));
  return Number.isNaN(parsed) ? new Date() : new Date(parsed);
}

export function decryptFcmConfig(configEncrypted: string): Record<string, unknown> {
  return JSON.parse(decrypt(configEncrypted)) as Record<string, unknown>;
}

export async function getActiveFcmCredential(db: Database) {
  const [row] = await db
    .select()
    .from(fcmCredentials)
    .where(eq(fcmCredentials.isActive, true))
    .limit(1);
  return row ?? null;
}

export async function requireActiveFcmCredentialId(db: Database): Promise<string | null> {
  const active = await getActiveFcmCredential(db);
  return active?.id ?? null;
}

export function summarizeFcmCredential(
  row: typeof fcmCredentials.$inferSelect,
  listening: boolean,
  serverCount: number,
  activeServer: { name: string; playerId: string } | null,
): FcmCredentialSummary {
  const registeredAtMs = row.registeredAt.getTime();
  const status = computeFcmCredentialStatus(registeredAtMs, row.isActive && listening);
  return {
    id: row.id,
    label: row.label,
    isActive: row.isActive,
    registeredAt: status.registeredAt!,
    expiresAt: status.expiresAt!,
    daysRemaining: status.daysRemaining ?? 0,
    warning: status.warning,
    expired: status.expired,
    listening: row.isActive && listening,
    serverCount,
    activeServerName: activeServer?.name ?? null,
    masterPlayerId: activeServer?.playerId ?? null,
  };
}

export async function listFcmCredentialSummaries(
  db: Database,
  rustPlus: RustPlusManager,
): Promise<FcmCredentialSummary[]> {
  const listening = rustPlus.getStatus().fcmListening;
  const rows = await db.select().from(fcmCredentials).orderBy(fcmCredentials.createdAt);
  const summaries: FcmCredentialSummary[] = [];

  for (const row of rows) {
    const servers = await db
      .select({
        id: rustServers.id,
        name: rustServers.name,
        playerId: rustServers.playerId,
        isActive: rustServers.isActive,
      })
      .from(rustServers)
      .where(eq(rustServers.fcmCredentialId, row.id));

    const activeServer = servers.find((s) => s.isActive) ?? null;
    summaries.push(
      summarizeFcmCredential(row, listening, servers.length, activeServer),
    );
  }

  return summaries;
}

export async function getActiveFcmCredentialStatus(
  db: Database,
  rustPlus: RustPlusManager,
): Promise<FcmCredentialStatus> {
  const active = await getActiveFcmCredential(db);
  if (!active) {
    return {
      configured: false,
      listening: false,
      registeredAt: null,
      expiresAt: null,
      daysRemaining: null,
      warning: true,
      expired: false,
    };
  }

  return computeFcmCredentialStatus(
    active.registeredAt.getTime(),
    rustPlus.getStatus().fcmListening,
    true,
  );
}

async function setExclusiveActiveFcm(db: Database, credentialId: string): Promise<void> {
  const now = new Date();
  await db.update(fcmCredentials).set({ isActive: false, updatedAt: now });
  await db
    .update(fcmCredentials)
    .set({ isActive: true, updatedAt: now })
    .where(eq(fcmCredentials.id, credentialId));
}

export async function createFcmCredential(
  db: Database,
  rustPlus: RustPlusManager,
  label: string,
  config: Record<string, unknown>,
  options?: { activate?: boolean },
): Promise<FcmCredentialSummary> {
  const prepared = prepareFcmConfigForSave(config, { replace: true });
  const registeredAt = parseRegisteredAtFromConfig(prepared);
  const now = new Date();
  const id = generateId();
  const shouldActivate =
    options?.activate ?? (await db.select().from(fcmCredentials)).length === 0;

  if (shouldActivate) {
    await db.update(fcmCredentials).set({ isActive: false, updatedAt: now });
  }

  await db.insert(fcmCredentials).values({
    id,
    label: label.trim() || "Master bot",
    configEncrypted: encrypt(JSON.stringify(prepared)),
    registeredAt,
    isActive: shouldActivate,
    createdAt: now,
    updatedAt: now,
  });

  if (shouldActivate) {
    await switchRustPlusToFcmCredential(db, rustPlus, id);
  }

  const [row] = await db.select().from(fcmCredentials).where(eq(fcmCredentials.id, id)).limit(1);
  return summarizeFcmCredential(row!, rustPlus.getStatus().fcmListening, 0, null);
}

export async function replaceFcmCredentialConfig(
  db: Database,
  rustPlus: RustPlusManager,
  credentialId: string,
  config: Record<string, unknown>,
): Promise<FcmCredentialSummary> {
  const [existing] = await db
    .select()
    .from(fcmCredentials)
    .where(eq(fcmCredentials.id, credentialId))
    .limit(1);
  if (!existing) throw new Error("FCM credential not found");

  const prepared = prepareFcmConfigForSave(config, { replace: true });
  const registeredAt = parseRegisteredAtFromConfig(prepared);
  const now = new Date();

  await db
    .update(fcmCredentials)
    .set({
      configEncrypted: encrypt(JSON.stringify(prepared)),
      registeredAt,
      updatedAt: now,
    })
    .where(eq(fcmCredentials.id, credentialId));

  if (existing.isActive) {
    await rustPlus.reloadFcmListener({ config: prepared });
  }

  const servers = await db
    .select()
    .from(rustServers)
    .where(eq(rustServers.fcmCredentialId, credentialId));
  const activeServer = servers.find((s) => s.isActive) ?? null;

  const [row] = await db
    .select()
    .from(fcmCredentials)
    .where(eq(fcmCredentials.id, credentialId))
    .limit(1);
  return summarizeFcmCredential(
    row!,
    rustPlus.getStatus().fcmListening,
    servers.length,
    activeServer,
  );
}

export async function renameFcmCredential(
  db: Database,
  credentialId: string,
  label: string,
): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Label is required");

  const [existing] = await db
    .select({ id: fcmCredentials.id })
    .from(fcmCredentials)
    .where(eq(fcmCredentials.id, credentialId))
    .limit(1);
  if (!existing) throw new Error("FCM credential not found");

  await db
    .update(fcmCredentials)
    .set({ label: trimmed, updatedAt: new Date() })
    .where(eq(fcmCredentials.id, credentialId));
}

export async function switchRustPlusToFcmCredential(
  db: Database,
  rustPlus: RustPlusManager,
  credentialId: string,
): Promise<void> {
  const [credential] = await db
    .select()
    .from(fcmCredentials)
    .where(eq(fcmCredentials.id, credentialId))
    .limit(1);
  if (!credential) throw new Error("FCM credential not found");

  const status = rustPlus.getStatus();
  if (status.activeServerId) {
    await rustPlus.disconnectServer(status.activeServerId);
  }

  const config = decryptFcmConfig(credential.configEncrypted);
  await rustPlus.reloadFcmListener({ config });

  const [server] = await db
    .select()
    .from(rustServers)
    .where(
      and(eq(rustServers.fcmCredentialId, credentialId), eq(rustServers.isActive, true)),
    )
    .limit(1);

  if (server) {
    await reconnectRustServer(db, rustPlus, server);
  }
}

export async function activateFcmCredential(
  db: Database,
  rustPlus: RustPlusManager,
  credentialId: string,
): Promise<FcmCredentialSummary> {
  const [credential] = await db
    .select()
    .from(fcmCredentials)
    .where(eq(fcmCredentials.id, credentialId))
    .limit(1);
  if (!credential) throw new Error("FCM credential not found");
  if (credential.isActive) {
    const summaries = await listFcmCredentialSummaries(db, rustPlus);
    return summaries.find((s) => s.id === credentialId)!;
  }

  await setExclusiveActiveFcm(db, credentialId);
  await switchRustPlusToFcmCredential(db, rustPlus, credentialId);

  const summaries = await listFcmCredentialSummaries(db, rustPlus);
  return summaries.find((s) => s.id === credentialId)!;
}

export async function deleteFcmCredential(
  db: Database,
  rustPlus: RustPlusManager,
  credentialId: string,
  options?: { userId?: string },
): Promise<void> {
  const [credential] = await db
    .select()
    .from(fcmCredentials)
    .where(eq(fcmCredentials.id, credentialId))
    .limit(1);
  if (!credential) throw new Error("FCM credential not found");

  const servers = await db
    .select()
    .from(rustServers)
    .where(eq(rustServers.fcmCredentialId, credentialId));

  for (const server of servers) {
    await deleteRustServer(db, rustPlus, server.id);
  }

  const wasActive = credential.isActive;
  await db.delete(fcmCredentials).where(eq(fcmCredentials.id, credentialId));

  await logAudit(db, {
    userId: options?.userId,
    action: "fcm_credential_deleted",
    targetType: "fcm_credential",
    targetId: credentialId,
    metadata: { label: credential.label, wasActive },
  });

  if (wasActive) {
    rustPlus.stopFcmListener();
    const [next] = await db.select().from(fcmCredentials).limit(1);
    if (next) {
      await activateFcmCredential(db, rustPlus, next.id);
    }
  }
}

export async function purgeExpiredFcmCredentials(
  db: Database,
  rustPlus: RustPlusManager,
): Promise<number> {
  const rows = await db.select().from(fcmCredentials);
  let removed = 0;

  for (const row of rows) {
    const status = computeFcmCredentialStatus(row.registeredAt.getTime(), false);
    if (!status.expired) continue;

    console.warn(`[FCM] Removing expired credential "${row.label}" (${row.id})`);
    await deleteFcmCredential(db, rustPlus, row.id);
    removed += 1;
  }

  return removed;
}

/** Import legacy single-file config and attach orphan servers on first boot after migration. */
export async function migrateLegacyFcmConfigIfNeeded(db: Database): Promise<void> {
  const existing = await db.select().from(fcmCredentials).limit(1);
  if (existing.length > 0) {
    await assignOrphanServersToActiveFcm(db);
    return;
  }

  const legacyPath = env.rustplus.resolvedFcmConfigPath;
  const now = new Date();
  let credentialId: string | null = null;

  if (fs.existsSync(legacyPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(legacyPath, "utf8")) as Record<string, unknown>;
      const validated = validateFcmConfigPayload(raw);
      if (validated.ok) {
        const prepared = prepareFcmConfigForSave(validated.config);
        credentialId = generateId();
        await db.insert(fcmCredentials).values({
          id: credentialId,
          label: "Default master",
          configEncrypted: encrypt(JSON.stringify(prepared)),
          registeredAt: parseRegisteredAtFromConfig(prepared),
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        console.log("[FCM] Migrated legacy fcm-config.json into database");
      }
    } catch (err) {
      console.error("[FCM] Failed to migrate legacy fcm-config.json:", err);
    }
  }

  await assignOrphanServersToActiveFcm(db, credentialId);
}

async function assignOrphanServersToActiveFcm(
  db: Database,
  preferredCredentialId?: string | null,
): Promise<void> {
  const active = preferredCredentialId
    ? { id: preferredCredentialId }
    : await getActiveFcmCredential(db);
  if (!active) return;

  const orphans = await db
    .select({ id: rustServers.id })
    .from(rustServers)
    .where(isNull(rustServers.fcmCredentialId));

  if (orphans.length === 0) return;

  await db
    .update(rustServers)
    .set({ fcmCredentialId: active.id, updatedAt: new Date() })
    .where(isNull(rustServers.fcmCredentialId));

  console.log(`[FCM] Assigned ${orphans.length} server(s) to credential ${active.id}`);
}

/** Connect the FCM push listener for the active credential (may block on network). */
export async function connectActiveFcmListener(
  db: Database,
  rustPlus: RustPlusManager,
): Promise<void> {
  const active = await getActiveFcmCredential(db);
  if (!active) return;

  const config = decryptFcmConfig(active.configEncrypted);
  await rustPlus.reloadFcmListener({ config });
}

/** Migrate legacy config, then connect FCM — use connectActiveFcmListener after HTTP listen. */
export async function bootstrapActiveFcmListener(
  db: Database,
  rustPlus: RustPlusManager,
): Promise<void> {
  await migrateLegacyFcmConfigIfNeeded(db);
  await connectActiveFcmListener(db, rustPlus);
}

export function suggestedFcmRegisterPath(credentialId?: string): string {
  const file = credentialId ? `fcm-${credentialId.slice(0, 8)}.json` : "fcm-config.json";
  return path.join("data", "fcm", file);
}
