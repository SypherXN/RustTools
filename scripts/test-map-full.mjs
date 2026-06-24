// quick test all three map endpoint calls
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
const token = decrypt(server.player_token_encrypted);
const client = new RustPlus(server.ip, server.port, server.player_id, token);

function rpc(name, fn) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    fn((message) => {
      if (message.response?.error) {
        reject(new Error(`${name}: ${JSON.stringify(message.response.error)}`));
        return;
      }
      console.log(`${name} ok in ${Date.now() - t0}ms`);
      resolve(message.response);
    });
    setTimeout(() => reject(new Error(`${name} timeout`)), 60000);
  });
}

await new Promise((resolve, reject) => {
  client.on("connected", resolve);
  client.on("error", (e) => console.error("ERR:", e.message));
  client.connect();
  setTimeout(() => reject(new Error("connect timeout")), 15000);
});

const t0 = Date.now();
await rpc("getMap", (cb) => client.getMap(cb));
await rpc("getTeamInfo", (cb) => client.getTeamInfo(cb));
await rpc("getMapMarkers", (cb) => client.getMapMarkers(cb));
console.log(`all done in ${Date.now() - t0}ms`);

client.disconnect();
db.close();
