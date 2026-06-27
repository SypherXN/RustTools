import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config.js";

const WORKER_TIMEOUT_MS = 20 * 60_000;

function workerScriptPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "../procgen-parse-worker.js");
}

/** Parse a .map file in a child process with an isolated heap (keeps the API lean during parse). */
export function runProcgenParseInSubprocess(sourcePath: string, outDir: string): Promise<void> {
  const heapMb = env.procgenParseHeapMb;
  const workerPath = workerScriptPath();

  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = "";

    const child: ChildProcess = fork(workerPath, [sourcePath, outDir], {
      execArgv: [`--max-old-space-size=${heapMb}`],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "production" },
    });

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(
        new Error(
          `Procgen parse timed out after ${Math.round(WORKER_TIMEOUT_MS / 60_000)} minutes`,
        ),
      );
    }, WORKER_TIMEOUT_MS);

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      finish(err);
    });

    child.on("exit", (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      const detail = stderr.trim() || (signal ? `signal ${signal}` : `exit code ${code}`);
      finish(
        new Error(
          detail.includes("heap")
            ? `${detail} — try raising PROCGEN_PARSE_HEAP_MB (default 4096 on A1). On 1 GB VMs use 2048 with swap — see docs/SETUP.md`
            : detail,
        ),
      );
    });
  });
}
