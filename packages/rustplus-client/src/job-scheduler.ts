export interface ScheduledJob {
  id: string;
  intervalMs: number;
  /** Delay before the first run (stagger concurrent jobs). */
  initialDelayMs?: number;
  run: () => void | Promise<void>;
}

export interface DelayedJob {
  id: string;
  runAt: number;
  run: () => void | Promise<void>;
}

export class JobScheduler {
  private intervalTimers = new Map<string, ReturnType<typeof setInterval>>();
  private bootstrapTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private delayedTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private delayedJobs = new Map<string, DelayedJob>();
  private running = new Set<string>();

  register(job: ScheduledJob): void {
    this.unregister(job.id);

    const execute = () => {
      if (this.running.has(job.id)) return;
      this.running.add(job.id);
      void Promise.resolve(job.run())
        .catch((err) => {
          console.error(`[JobScheduler] Job "${job.id}" failed:`, err);
        })
        .finally(() => {
          this.running.delete(job.id);
        });
    };

    const startInterval = () => {
      const timer = setInterval(execute, job.intervalMs);
      this.intervalTimers.set(job.id, timer);
    };

    const initialDelayMs = job.initialDelayMs ?? 0;
    if (initialDelayMs > 0) {
      const bootstrap = setTimeout(() => {
        this.bootstrapTimers.delete(job.id);
        execute();
        startInterval();
      }, initialDelayMs);
      this.bootstrapTimers.set(job.id, bootstrap);
    } else {
      startInterval();
    }
  }

  scheduleOnce(job: DelayedJob): void {
    this.cancelDelayed(job.id);
    this.delayedJobs.set(job.id, job);
    const delayMs = Math.max(0, job.runAt - Date.now());
    const timer = setTimeout(() => {
      this.delayedTimers.delete(job.id);
      this.delayedJobs.delete(job.id);
      void Promise.resolve(job.run()).catch((err) => {
        console.error(`[JobScheduler] Delayed job "${job.id}" failed:`, err);
      });
    }, delayMs);
    this.delayedTimers.set(job.id, timer);
  }

  cancelDelayed(id: string): void {
    const timer = this.delayedTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.delayedTimers.delete(id);
    }
    this.delayedJobs.delete(id);
  }

  unregister(id: string): void {
    const bootstrap = this.bootstrapTimers.get(id);
    if (bootstrap) {
      clearTimeout(bootstrap);
      this.bootstrapTimers.delete(id);
    }
    const timer = this.intervalTimers.get(id);
    if (timer) {
      clearInterval(timer);
      this.intervalTimers.delete(id);
    }
    this.running.delete(id);
    this.cancelDelayed(id);
  }

  stopAll(): void {
    for (const id of [...this.intervalTimers.keys(), ...this.bootstrapTimers.keys()]) {
      this.unregister(id);
    }
    for (const id of [...this.delayedTimers.keys()]) {
      this.cancelDelayed(id);
    }
  }
}
