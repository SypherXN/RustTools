import { apiFetch, apiUpload, apiUrl } from "./api";

export type AlarmSoundStatus = {
  configured: boolean;
  originalName: string | null;
  mimeType: string | null;
  uploadedAt: string | null;
};

let cachedObjectUrl: string | null = null;
let cachedForEpoch = -1;

export function invalidateAlarmSoundCache(): void {
  if (cachedObjectUrl) {
    URL.revokeObjectURL(cachedObjectUrl);
    cachedObjectUrl = null;
  }
  cachedForEpoch = -1;
}

export async function fetchAlarmSoundStatus(): Promise<AlarmSoundStatus> {
  return apiFetch<AlarmSoundStatus>("/servers/active/notifications/alarm-sound/status");
}

export async function prefetchCustomAlarmSound(epoch: number): Promise<boolean> {
  if (cachedObjectUrl && cachedForEpoch === epoch) return true;

  invalidateAlarmSoundCache();
  const status = await fetchAlarmSoundStatus();
  if (!status.configured) return false;

  const res = await fetch(apiUrl("/servers/active/notifications/alarm-sound"), {
    credentials: "include",
  });
  if (!res.ok) return false;

  const blob = await res.blob();
  cachedObjectUrl = URL.createObjectURL(blob);
  cachedForEpoch = epoch;
  return true;
}

export function playDefaultSiren(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    const sweep = setInterval(() => {
      osc.frequency.value = osc.frequency.value === 880 ? 440 : 880;
    }, 250);
    setTimeout(() => {
      clearInterval(sweep);
      osc.stop();
      void ctx.close();
    }, 4000);
  } catch {
    /* autoplay may be blocked until user gesture */
  }
}

export async function playAlarmSound(options: {
  browserSiren: boolean;
  customAlarmSound: boolean;
  epoch: number;
}): Promise<void> {
  if (!options.browserSiren) return;

  if (options.customAlarmSound) {
    if (!cachedObjectUrl || cachedForEpoch !== options.epoch) {
      await prefetchCustomAlarmSound(options.epoch);
    }
    if (cachedObjectUrl) {
      try {
        const audio = new Audio(cachedObjectUrl);
        audio.volume = 1;
        await audio.play();
        return;
      } catch {
        /* fall through to default siren */
      }
    }
  }

  playDefaultSiren();
}

export async function uploadAlarmSound(file: File): Promise<{
  status: AlarmSoundStatus;
}> {
  const form = new FormData();
  form.append("file", file);
  return apiUpload("/servers/active/notifications/alarm-sound", form);
}

export async function deleteAlarmSound(): Promise<void> {
  await apiFetch("/servers/active/notifications/alarm-sound", { method: "DELETE" });
  invalidateAlarmSoundCache();
}
