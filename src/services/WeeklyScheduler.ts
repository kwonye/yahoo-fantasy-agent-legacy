export interface WeeklyOptions {
  day: number; // 0=Sunday ... 6=Saturday (local)
  hour: number; // 0-23
  minute?: number; // 0-59
  runOnStart?: boolean;
}

export type WeeklyTask = () => Promise<void> | void;

export class WeeklyScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly opts: WeeklyOptions;
  private readonly task: WeeklyTask;

  constructor(task: WeeklyTask, opts: WeeklyOptions) {
    this.task = task;
    this.opts = { ...opts, minute: opts.minute ?? 0 };
  }

  start() {
    if (this.opts.runOnStart) void this.safeRun();
    this.scheduleNext();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext() {
    const now = new Date();
    const next = new Date(now);
    // Set to this week's target day/hour/minute
    const targetDow = Math.max(0, Math.min(6, this.opts.day));
    const currDow = now.getDay();
    let delta = targetDow - currDow;
    if (delta < 0) delta += 7; // next week
    next.setDate(now.getDate() + delta);
    next.setHours(this.opts.hour, this.opts.minute ?? 0, 0, 0);
    if (next <= now) {
      // If today and time already passed, push one week
      next.setDate(next.getDate() + 7);
    }
    const delay = next.getTime() - now.getTime();
    this.timer = setTimeout(async () => {
      await this.safeRun();
      this.scheduleNext();
    }, delay);
  }

  private async safeRun() {
    try { await this.task(); } catch {}
  }
}

