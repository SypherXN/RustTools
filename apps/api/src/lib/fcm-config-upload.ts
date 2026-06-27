import fs from "node:fs";
import path from "node:path";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import { writeFcmConfigFile } from "@rusttools/rustplus-client";

/**
 * Validate FCM config by starting the listener against a temp file, then atomically replace the live config.
 * Leaves the previous config in place if the new file fails to start.
 */
export async function replaceFcmConfigFile(
  rustPlus: RustPlusManager,
  configPath: string,
  config: Record<string, unknown>,
): Promise<void> {
  const resolved = path.resolve(configPath);
  const tmpPath = `${resolved}.upload.tmp`;

  writeFcmConfigFile(tmpPath, config, { replace: true });

  try {
    await rustPlus.reloadFcmListener(tmpPath);
  } catch (err) {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
    throw err;
  }

  rustPlus.stopFcmListener();

  if (fs.existsSync(resolved)) {
    fs.unlinkSync(resolved);
  }
  fs.renameSync(tmpPath, resolved);

  await rustPlus.reloadFcmListener(resolved);
}
