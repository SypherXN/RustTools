export interface ScheduledJob {
  id: string;
  intervalMs: number;
  run: () => void | Promise<void>;
}

export interface DelayedJob {
  id: string;
  runAt: number;
  run: () => void | Promise<void>;
}

export class JobScheduler {
  private intervalTimers = new Map<string, ReturnType<typeof setInterval>>();
  private delayedTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private delayedJobs = new Map<string, DelayedJob>();

  register(job: ScheduledJob): void {
    this.unregister(job.id);
    const timer = setInterval(() => {
      void Promise.resolve(job.run()).catch((err) => {
        console.error(`[JobScheduler] Job "${job.id}" failed:`, err);
      });
    }, job.intervalMs);
    this.intervalTimers.set(job.id, timer);
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
    const timer = this.intervalTimers.get(id);
    if (timer) {
      clearInterval(timer);
      this.intervalTimers.delete(id);
    }
    this.cancelDelayed(id);
  }

  stopAll(): void {
    for (const id of [...this.intervalTimers.keys()]) {
      this.unregister(id);
    }
    for (const id of [...this.delayedTimers.keys()]) {
      this.cancelDelayed(id);
    }
  }
}
