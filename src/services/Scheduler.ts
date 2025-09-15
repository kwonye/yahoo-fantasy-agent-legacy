export interface ScheduleOptions {
  hour: number; // 0-23 in provided time zone (or local if none)
  minute?: number; // 0-59
  runOnStart?: boolean;
  timeZone?: string; // IANA time zone (e.g., 'America/New_York'); defaults to local
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
    // Compute next run in the specified time zone (defaults to local)
    const { DateTime } = require('luxon');
    const zone = this.opts.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = DateTime.now().setZone(zone);
    let next = now.set({ hour: this.opts.hour, minute: this.opts.minute ?? 0, second: 0, millisecond: 0 });
    if (next <= now) {
      next = next.plus({ days: 1 });
    }
    const delay = Math.max(0, next.toMillis() - Date.now());
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
