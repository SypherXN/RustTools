import { and, eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { fcmCredentials, rustEntities, rustServers } from "@rusttools/db";
import type { RustPlusManager, ServerCredentials } from "@rusttools/rustplus-client";
import type { CompanionAuth } from "@rusttools/shared";
import {
  getCompanionAuth,
  RustPlusConnectionError,
  type FcmConfig,
} from "@rusttools/rustplus-client";
import { decrypt } from "../lib/crypto.js";
import { markEntityValidated } from "../lib/entity-lifecycle.js";
import { checkServerWipe } from "../lib/wipe-tracker.js";
import { decryptFcmConfig, getActiveFcmCredential } from "../lib/fcm-credentials.js";

/** Stable, secret-free text for logs and API errors. */
export function sanitizeRustPlusError(err: unknown): string {
  if (err instanceof RustPlusConnectionError) return err.message;
  return "Rust+ connection failed";
}

function requireCompanionAuth(
  config: Record<string, unknown>,
  playerId: string,
): CompanionAuth {
  try {
    return getCompanionAuth(config as FcmConfig, playerId);
  } catch (err) {
    throw new RustPlusConnectionError(
      err instanceof Error ? err.message : "Rust+ companion auth is unavailable",
    );
  }
}

async function loadServerFcmConfig(
  db: Database,
  server: typeof rustServers.$inferSelect,
): Promise<Record<string, unknown>> {
  const credentialId =
    server.fcmCredentialId ?? (await getActiveFcmCredential(db))?.id ?? null;
  if (!credentialId) throw new Error("No master account is configured for this server");

  const [row] = await db
    .select({ configEncrypted: fcmCredentials.configEncrypted })
    .from(fcmCredentials)
    .where(eq(fcmCredentials.id, credentialId))
    .limit(1);
  if (!row) throw new Error("No master account is configured for this server");

  try {
    return decryptFcmConfig(row.configEncrypted);
  } catch {
    throw new Error("Stored master account config cannot be read");
  }
}

/**
 * Single source of connection credentials for relay and legacy rows.
 * Relay rows read the fresh encrypted slot config and require companion auth
 * that matches the server player BEFORE any socket is created.
 */
export async function buildServerConnectionCredentials(
  db: Database,
  server: typeof rustServers.$inferSelect,
): Promise<ServerCredentials> {
  const base = {
    id: server.id,
    name: server.name,
    playerId: server.playerId,
    playerToken: decrypt(server.playerTokenEncrypted),
  };

  if (!server.companionServerId) {
    return { ...base, ip: server.ip, port: server.port };
  }

  const config = await loadServerFcmConfig(db, server);
  const companionAuth = requireCompanionAuth(config, server.playerId);

  // Sentinels only satisfy legacy NOT NULL columns; relay never dials ip/port.
  return {
    ...base,
    ip: "",
    port: 0,
    companionServerId: server.companionServerId,
    companionAuth,
  };
}

function scheduleEntityResubscribe(
  db: Database,
  rustPlus: RustPlusManager,
  serverId: string,
): void {
  void (async () => {
    const entities = await db
      .select()
      .from(rustEntities)
      .where(eq(rustEntities.serverId, serverId));

    for (const entity of entities) {
      try {
        await rustPlus.subscribeEntity(entity.entityId);
        markEntityValidated(serverId, entity.entityId);
      } catch (err) {
        console.error(`[RustPlus] Failed to subscribe entity ${entity.entityId}:`, err);
      }
    }
  })();
}

export async function reconnectRustServer(
  db: Database,
  rustPlus: RustPlusManager,
  server: typeof rustServers.$inferSelect,
): Promise<ServerCredentials> {
  // Stop serving the previous runtime server before auth validation can fail:
  // a relay pair that cannot connect must not leave the old server live.
  try {
    await rustPlus.unsubscribeCamera();
  } catch {
    // No camera session; nothing to clear.
  }
  const previousActiveId = rustPlus.getStatus().activeServerId;
  if (previousActiveId) {
    await rustPlus.disconnectServer(previousActiveId, { dropCredentials: true });
  }

  const credentials = await buildServerConnectionCredentials(db, server);
  await rustPlus.connectServer(credentials);
  rustPlus.setActiveServer(server.id);

  try {
    const info = await rustPlus.getServerInfo();
    await checkServerWipe(db, rustPlus, server.id, info);
  } catch (err) {
    console.error(
      `[RustPlus] Startup getInfo failed for ${server.name} — team/map grid labels may use defaults until Rust+ responds:`,
      err instanceof Error ? err.message : err,
    );
  }

  scheduleEntityResubscribe(db, rustPlus, server.id);
  return credentials;
}

export async function reconnectStoredServers(
  db: Database,
  rustPlus: RustPlusManager,
): Promise<void> {
  const activeFcm = await getActiveFcmCredential(db);
  if (!activeFcm) return;

  const [server] = await db
    .select()
    .from(rustServers)
    .where(
      and(eq(rustServers.isActive, true), eq(rustServers.fcmCredentialId, activeFcm.id)),
    )
    .limit(1);

  if (!server) return;

  try {
    await reconnectRustServer(db, rustPlus, server);
    console.log(`[RustPlus] Reconnected to server: ${server.name}`);
  } catch (err) {
    console.error(
      `[RustPlus] Failed to reconnect to ${server.name}:`,
      sanitizeRustPlusError(err),
    );
  }
}
