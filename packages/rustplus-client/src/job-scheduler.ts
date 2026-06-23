export interface ScheduledJob {
  id: string;
  intervalMs: number;
  run: () => void | Promise<void>;
}

export class JobScheduler {
  private timers = new Map<string, ReturnType<typeof setInterval>>();

  register(job: ScheduledJob): void {
    this.unregister(job.id);
    const timer = setInterval(() => {
      void Promise.resolve(job.run()).catch((err) => {
        console.error(`[JobScheduler] Job "${job.id}" failed:`, err);
      });
    }, job.intervalMs);
    this.timers.set(job.id, timer);
  }

  unregister(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }
  }

  stopAll(): void {
    for (const id of [...this.timers.keys()]) {
      this.unregister(id);
    }
  }
}
