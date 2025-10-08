/**
 * @fileoverview A scheduler for running tasks at specific times relative to NFL game kickoffs.
 */

/**
 * @typedef {function} KickoffTask
 * @description A function to be executed by the scheduler. Can be synchronous or asynchronous.
 */
export type KickoffTask = () => Promise<void> | void;

/**
 * @private
 * @interface WindowDef
 * @description Defines a weekly time window.
 * @property {number} dow - Day of the week (0=Sunday, 6=Saturday).
 * @property {number} hh - Hour of the day (0-23).
 * @property {number} mm - Minute of the hour (0-59).
 */
interface WindowDef { dow: number; hh: number; mm: number }

/**
 * @interface KickoffOptions
 * @description Options for configuring the KickoffScheduler.
 * @property {number[]} [preMinutes] - An array of minutes before each kickoff window to run the task. Defaults to `[30]`.
 * @property {WindowDef[]} [windows] - An array of kickoff time windows to schedule against. Defaults to standard NFL kickoff times.
 * @property {string} [timeZone] - The IANA time zone for interpreting kickoff windows. Defaults to 'America/New_York'.
 */
export interface KickoffOptions {
  preMinutes?: number[]; // Minutes before kickoff to run checks - defaults to [30] (only 30 minutes before)
  windows?: WindowDef[]; // NFL weekly windows (ET canonical): Thu 20:15, Sun 09:30, Sun 13:00, Sun 16:05, Sun 16:25, Sun 20:20, Mon 20:15
  timeZone?: string; // IANA zone for interpreting kickoff windows (default: America/New_York)
}

/**
 * @class KickoffScheduler
 * @description Schedules a task to run at specific times relative to standard NFL game kickoff windows.
 * This is useful for performing actions like last-minute lineup checks.
 */
export class KickoffScheduler {
  private timers: NodeJS.Timeout[] = [];
  private readonly opts: Required<Omit<KickoffOptions, 'timeZone'>> & { timeZone: string };
  private readonly task: KickoffTask;

  /**
   * @constructor
   * @param {KickoffTask} task - The task to be executed at scheduled times.
   * @param {KickoffOptions} [opts={}] - Configuration options for the scheduler.
   */
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

  /**
   * @method start
   * @description Starts the scheduler. It clears any existing timers and schedules new ones based on the configured windows.
   */
  start() {
    this.stop();
    for (const w of this.opts.windows) {
      for (const pre of this.opts.preMinutes) {
        this.scheduleNext(w, pre);
      }
    }
  }

  /**
   * @method stop
   * @description Stops all currently scheduled timers.
   */
  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  /**
   * @private
   * @method scheduleNext
   * @description Calculates the next run time for a given window and pre-kickoff minute offset, then sets a timer.
   * @param {WindowDef} w - The kickoff window definition.
   * @param {number} pre - The number of minutes before kickoff to run the task.
   */
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

  /**
   * @private
   * @method setTimer
   * @description Sets a Node.js `setTimeout` to execute the task and then reschedule the next occurrence.
   * @param {Date} when - The exact date and time to run the task.
   * @param {WindowDef} w - The kickoff window definition for rescheduling.
   * @param {number} pre - The pre-kickoff minute offset for rescheduling.
   */
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

/**
 * @private
 * @function nextDowTimeZoned
 * @description Calculates the next occurrence of a specific day-of-week and time in a given time zone.
 * @param {number} dow - The target day of the week (0=Sunday).
 * @param {number} hh - The target hour.
 * @param {number} mm - The target minute.
 * @param {any} now - The current time as a Luxon DateTime object.
 * @param {string} zone - The IANA time zone.
 * @returns {any} A Luxon DateTime object representing the next occurrence.
 */
function nextDowTimeZoned(dow: number, hh: number, mm: number, now: any, zone: string) {
  const { DateTime } = require('luxon');
  const currDow0 = now.weekday % 7; // 0..6
  const delta = (dow - currDow0 + 7) % 7;
  let d = now.plus({ days: delta }).set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
  if (d <= now) d = d.plus({ days: 7 });
  // Ensure Date in system zone with same instant
  return DateTime.fromMillis(d.toMillis(), { zone }).toJSDate ? d : d; // d is a DateTime; caller uses toJSDate/Date math
}
