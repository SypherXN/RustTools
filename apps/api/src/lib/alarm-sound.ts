import fs from "node:fs";
import path from "node:path";
import { env } from "../config.js";

export const ALARM_SOUND_MAX_BYTES = 2 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Map<string, string>([
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".ogg", "audio/ogg"],
  [".webm", "audio/webm"],
]);

export type AlarmSoundMeta = {
  filename: string;
  mimeType: string;
  originalName: string;
  uploadedAt: string;
};

function alarmSoundDir(serverId: string): string {
  return path.join(env.dataDir, "alarm-sounds", serverId);
}

function metaPath(serverId: string): string {
  return path.join(alarmSoundDir(serverId), "meta.json");
}

export function resolveAlarmSoundExtension(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext) ? ext : null;
}

export function mimeTypeForAlarmExtension(ext: string): string | null {
  return ALLOWED_EXTENSIONS.get(ext.toLowerCase()) ?? null;
}

export function getAlarmSoundMeta(serverId: string): AlarmSoundMeta | null {
  const metaFile = metaPath(serverId);
  if (!fs.existsSync(metaFile)) return null;

  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as AlarmSoundMeta;
    const filePath = path.join(alarmSoundDir(serverId), meta.filename);
    if (!fs.existsSync(filePath)) return null;
    return meta;
  } catch {
    return null;
  }
}

export function hasCustomAlarmSound(serverId: string): boolean {
  return getAlarmSoundMeta(serverId) != null;
}

export function readAlarmSoundFile(serverId: string): { meta: AlarmSoundMeta; data: Buffer } | null {
  const meta = getAlarmSoundMeta(serverId);
  if (!meta) return null;
  const filePath = path.join(alarmSoundDir(serverId), meta.filename);
  return { meta, data: fs.readFileSync(filePath) };
}

export async function saveAlarmSoundFile(
  serverId: string,
  originalName: string,
  buffer: Buffer,
): Promise<AlarmSoundMeta> {
  const ext = resolveAlarmSoundExtension(originalName);
  if (!ext) {
    throw new Error("Unsupported format — use MP3, WAV, OGG, or WebM");
  }
  if (buffer.length > ALARM_SOUND_MAX_BYTES) {
    throw new Error(`File too large — max ${Math.round(ALARM_SOUND_MAX_BYTES / 1024 / 1024)} MB`);
  }
  if (buffer.length === 0) {
    throw new Error("Empty audio file");
  }

  const dir = alarmSoundDir(serverId);
  fs.mkdirSync(dir, { recursive: true });

  for (const entry of fs.readdirSync(dir)) {
    if (entry !== "meta.json") {
      fs.unlinkSync(path.join(dir, entry));
    }
  }

  const filename = `alarm${ext}`;
  const meta: AlarmSoundMeta = {
    filename,
    mimeType: mimeTypeForAlarmExtension(ext)!,
    originalName: path.basename(originalName),
    uploadedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(dir, filename), buffer);
  fs.writeFileSync(metaPath(serverId), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return meta;
}

export function deleteAlarmSoundFile(serverId: string): void {
  const dir = alarmSoundDir(serverId);
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}
