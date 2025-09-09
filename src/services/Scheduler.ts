export interface ScheduleOptions {
  hour: number; // 0-23 local time
  minute?: number; // 0-59
  runOnStart?: boolean;
}

export type Task = () => Promise<void> | void;

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly opts: ScheduleOptions;
  private readonly task: Task;

  constructor(task: Task, opts: ScheduleOptions) {
    this.task = task;
    this.opts = { ...opts, minute: opts.minute ?? 0 };
  }

  start() {
    if (this.opts.runOnStart) {
      void this.safeRun();
    }
    this.scheduleNext();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(this.opts.hour, this.opts.minute ?? 0, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    const delay = next.getTime() - now.getTime();
    this.timer = setTimeout(async () => {
      await this.safeRun();
      this.scheduleNext();
    }, delay);
  }

  private async safeRun() {
    try {
      await this.task();
    } catch (e) {
      // Swallow to avoid crashing scheduler; caller should log in task
    }
  }
}

