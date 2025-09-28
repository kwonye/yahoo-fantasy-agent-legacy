export type KickoffTask = () => Promise<void> | void;

interface WindowDef { dow: number; hh: number; mm: number }

export interface KickoffOptions {
  preMinutes?: number[]; // Minutes before kickoff to run checks - defaults to [30] (only 30 minutes before)
  windows?: WindowDef[]; // NFL weekly windows (ET canonical): Thu 20:15, Sun 09:30, Sun 13:00, Sun 16:05, Sun 16:25, Sun 20:20, Mon 20:15
  timeZone?: string; // IANA zone for interpreting kickoff windows (default: America/New_York)
}

export class KickoffScheduler {
  private timers: NodeJS.Timeout[] = [];
  private readonly opts: Required<Omit<KickoffOptions, 'timeZone'>> & { timeZone: string };
  private readonly task: KickoffTask;

  constructor(task: KickoffTask, opts: KickoffOptions = {}) {
    this.task = task;
    this.opts = {
      preMinutes: opts.preMinutes ?? [30], // ONLY 30 minutes before kickoff
      windows: opts.windows ?? [
        { dow: 4, hh: 20, mm: 15 }, // Thu Night (TNF) 8:15 PM ET
        { dow: 0, hh: 9,  mm: 30 }, // Sun International window (London/Europe) 9:30 AM ET (occasional)
        { dow: 0, hh: 13, mm: 0  }, // Sun Early 1:00 PM ET
        { dow: 0, hh: 16, mm: 5  }, // Sun Late 4:05 PM ET
        { dow: 0, hh: 16, mm: 25 }, // Sun Late 4:25 PM ET
        { dow: 0, hh: 20, mm: 20 }, // Sun Night (SNF) 8:20 PM ET
        { dow: 1, hh: 20, mm: 15 }, // Mon Night (MNF) 8:15 PM ET
      ],
      timeZone: opts.timeZone || 'America/New_York',
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
    const { DateTime } = require('luxon');
    const zone = this.opts.timeZone;
    const now = DateTime.now().setZone(zone);
    const kickoff = nextDowTimeZoned(w.dow, w.hh, w.mm, now, zone);
    let runAt = kickoff.minus({ minutes: pre });
    if (runAt <= now) {
      runAt = runAt.plus({ days: 7 });
    }
    this.setTimer(runAt.toJSDate(), w, pre);
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

function nextDowTimeZoned(dow: number, hh: number, mm: number, now: any, zone: string) {
  const { DateTime } = require('luxon');
  const currDow0 = now.weekday % 7; // 0..6
  const delta = (dow - currDow0 + 7) % 7;
  let d = now.plus({ days: delta }).set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
  if (d <= now) d = d.plus({ days: 7 });
  // Ensure Date in system zone with same instant
  return DateTime.fromMillis(d.toMillis(), { zone }).toJSDate ? d : d; // d is a DateTime; caller uses toJSDate/Date math
}
