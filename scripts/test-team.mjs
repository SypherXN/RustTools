import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDecipheriv, createHash, randomBytes } from "node:crypto";
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
    client.on("error", reject);
    client.connect();
    setTimeout(() => reject(new Error("connect timeout")), 15000);
  });
}

function getTeamInfo() {
  return new Promise((resolve, reject) => {
    client.on("message", (msg) => console.log("MSG keys:", Object.keys(msg), msg.response ? Object.keys(msg.response) : null));
    client.getTeamInfo((message) => {
      console.log("team callback fired");
      if (message.response?.error) {
        reject(new Error(JSON.stringify(message.response.error)));
        return;
      }
      resolve(message.response?.teamInfo);
    });
    setTimeout(() => reject(new Error("team timeout")), 10000);
  });
}

function getInfo() {
  return new Promise((resolve, reject) => {
    client.getInfo((message) => {
      if (message.response?.error) {
        reject(new Error(JSON.stringify(message.response.error)));
        return;
      }
      resolve(message.response?.info);
    });
    setTimeout(() => reject(new Error("info timeout")), 10000);
  });
}

function getTime() {
  return new Promise((resolve, reject) => {
    client.getTime((message) => {
      if (message.response?.error) {
        reject(new Error(JSON.stringify(message.response.error)));
        return;
      }
      resolve(message.response?.time);
    });
    setTimeout(() => reject(new Error("time timeout")), 10000);
  });
}

await waitConnected();
console.log("connected");
client.on("error", (e) => console.error("CLIENT ERROR:", e.message || e));

const info = await getInfo();
console.log("info name:", info?.name);

const time = await getTime();
console.log("RAW time:", JSON.stringify(time, null, 2));

const team = await getTeamInfo();
console.log("RAW teamInfo:", JSON.stringify(team, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));

client.disconnect();
db.close();
