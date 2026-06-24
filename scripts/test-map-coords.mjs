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

function worldToPixel(worldX, worldY, { imageWidth, imageHeight, oceanMargin, worldSize }) {
  const scale = (imageWidth - oceanMargin * 2) / worldSize;
  return {
    x: oceanMargin + worldX * scale,
    y: imageHeight - (oceanMargin + worldY * scale),
    scale,
  };
}

const db = new Database(path.resolve(repoRoot, "data/rusttools.db"));
const server = db.prepare("SELECT * FROM rust_servers WHERE is_active = 1 LIMIT 1").get();
const token = decrypt(server.player_token_encrypted);
const client = new RustPlus(server.ip, server.port, server.player_id, token);

await new Promise((resolve, reject) => {
  client.on("connected", resolve);
  client.on("error", reject);
  client.connect();
  setTimeout(() => reject(new Error("timeout")), 15000);
});

const map = await new Promise((resolve, reject) => {
  client.getMap((m) => {
    if (m.response?.error) reject(m.response.error);
    else resolve(m.response.map);
  });
  setTimeout(() => reject(new Error("map timeout")), 30000);
});

const info = await new Promise((resolve, reject) => {
  client.getInfo((m) => {
    if (m.response?.error) reject(m.response.error);
    else resolve(m.response.info);
  });
  setTimeout(() => reject(new Error("info timeout")), 10000);
});

const team = await new Promise((resolve, reject) => {
  client.getTeamInfo((m) => {
    if (m.response?.error) reject(m.response.error);
    else resolve(m.response.teamInfo);
  });
  setTimeout(() => reject(new Error("team timeout")), 10000);
});

const transform = {
  imageWidth: map.width,
  imageHeight: map.height,
  oceanMargin: map.oceanMargin,
  worldSize: info.mapSize,
};

console.log("transform:", transform);
console.log("sample monument:", map.monuments?.[0]);
const me = team.members?.find((m) => String(m.steamId) === server.player_id);
if (me) {
  console.log("my world pos:", me.x, me.y);
  console.log("my pixel pos:", worldToPixel(me.x, me.y, transform));
  console.log("old formula pixel:", { x: me.x, y: map.height - me.y });
}

client.disconnect();
db.close();
