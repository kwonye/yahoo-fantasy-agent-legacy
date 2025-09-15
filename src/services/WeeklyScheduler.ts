export interface WeeklyOptions {
  day: number; // 0=Sunday ... 6=Saturday in provided time zone (or local if none)
  hour: number; // 0-23
  minute?: number; // 0-59
  runOnStart?: boolean;
  timeZone?: string; // IANA time zone; defaults to local
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
    const { DateTime } = require('luxon');
    const zone = this.opts.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = DateTime.now().setZone(zone);
    const targetDow = Math.max(0, Math.min(6, this.opts.day));
    const currDow0 = now.weekday % 7; // Luxon: Mon=1..Sun=7; convert to 0..6 (Sun=0)
    let delta = (targetDow - currDow0 + 7) % 7;
    let next = now.plus({ days: delta }).set({ hour: this.opts.hour, minute: this.opts.minute ?? 0, second: 0, millisecond: 0 });
    if (next <= now) {
      next = next.plus({ days: 7 });
    }
    const delay = Math.max(0, next.toMillis() - Date.now());
    this.timer = setTimeout(async () => {
      await this.safeRun();
      this.scheduleNext();
    }, delay);
  }

  private async safeRun() {
    try { await this.task(); } catch {}
  }
}
