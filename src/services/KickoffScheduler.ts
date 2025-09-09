export type KickoffTask = () => Promise<void> | void;

interface WindowDef { dow: number; hh: number; mm: number }

export interface KickoffOptions {
  preMinutes?: number[]; // e.g., [90, 60, 30]
  windows?: WindowDef[]; // default NFL: Thu 20:20, Sun 13:00, Sun 16:25, Sun 20:20, Mon 20:15
}

export class KickoffScheduler {
  private timers: NodeJS.Timeout[] = [];
  private readonly opts: Required<KickoffOptions>;
  private readonly task: KickoffTask;

  constructor(task: KickoffTask, opts: KickoffOptions = {}) {
    this.task = task;
    this.opts = {
      preMinutes: opts.preMinutes ?? [90, 60, 30],
      windows: opts.windows ?? [
        { dow: 4, hh: 20, mm: 20 }, // Thu Night
        { dow: 0, hh: 13, mm: 0 },  // Sun Early
        { dow: 0, hh: 16, mm: 25 }, // Sun Late
        { dow: 0, hh: 20, mm: 20 }, // SNF
        { dow: 1, hh: 20, mm: 15 }, // MNF
      ],
    };
  }

  start() {
    this.stop();
    for (const w of this.opts.windows) {
      for (const pre of this.opts.preMinutes) {
        this.scheduleNext(w, pre);
      }
    }
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private scheduleNext(w: WindowDef, pre: number) {
    const now = new Date();
    const target = nextDowTime(w.dow, w.hh, w.mm);
    const runAt = new Date(target.getTime() - pre * 60000);
    if (runAt <= now) {
      // schedule for next week
      const nextWeek = new Date(runAt.getTime() + 7 * 24 * 60 * 60000);
      this.setTimer(nextWeek, w, pre);
    } else {
      this.setTimer(runAt, w, pre);
    }
  }

  private setTimer(when: Date, w: WindowDef, pre: number) {
    const delay = Math.max(0, when.getTime() - Date.now());
    const t = setTimeout(async () => {
      try { await this.task(); } catch {}
      // schedule following week occurrence
      this.scheduleNext(w, pre);
    }, delay);
    this.timers.push(t);
  }
}

function nextDowTime(dow: number, hh: number, mm: number): Date {
  const now = new Date();
  const d = new Date(now);
  const delta = (dow - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta);
  d.setHours(hh, mm, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 7);
  return d;
}

