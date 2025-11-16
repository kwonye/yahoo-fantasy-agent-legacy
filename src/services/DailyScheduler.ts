export interface DailyOptions {
  hour: number; // 0-23
  minute?: number; // 0-59
  runOnStart?: boolean;
  timeZone?: string; // IANA time zone; defaults to local
}

export type DailyTask = () => Promise<void> | void;

export class DailyScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly opts: DailyOptions;
  private readonly task: DailyTask;

  constructor(task: DailyTask, opts: DailyOptions) {
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
    try { await this.task(); } catch {}
  }
}
