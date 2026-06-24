import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDecipheriv, createHash } from "node:crypto";
import Database from "better-sqlite3";
import RustPlus from "@liamcottle/rustplus.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.resolve(repoRoot, ".env") });

function deriveKey() {
  return createHash("sha256").update(process.env.ENCRYPTION_KEY ?? "dev-encryption-key-32chars!!").digest();
}

function decrypt(ciphertext) {
  const data = Buffer.from(ciphertext, "base64");
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

const db = new Database(path.resolve(repoRoot, "data/rusttools.db"));
const server = db.prepare("SELECT * FROM rust_servers WHERE is_active = 1 LIMIT 1").get();
if (!server) {
  console.error("No active server");
  process.exit(1);
}

const token = decrypt(server.player_token_encrypted);
const client = new RustPlus(server.ip, server.port, server.player_id, token);

function waitConnected() {
  return new Promise((resolve, reject) => {
    client.on("connected", resolve);
    client.on("error", (e) => console.error("ERR:", e.message || e));
    client.connect();
    setTimeout(() => reject(new Error("connect timeout")), 15000);
  });
}

function getMap() {
  return new Promise((resolve, reject) => {
    client.getMap((message) => {
      if (message.response?.error) {
        reject(new Error(JSON.stringify(message.response.error)));
        return;
      }
      const map = message.response?.map;
      resolve({
        width: map?.width,
        height: map?.height,
        jpgLen: map?.jpgImage?.length ?? 0,
        keys: map ? Object.keys(map) : [],
      });
    });
    setTimeout(() => reject(new Error("map timeout")), 30000);
  });
}

await waitConnected();
console.log("connected");

try {
  const map = await getMap();
  console.log("map result:", map);
} catch (err) {
  console.error("map failed:", err.message);
}

client.disconnect();
db.close();
