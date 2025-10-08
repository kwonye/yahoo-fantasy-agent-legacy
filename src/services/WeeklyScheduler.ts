/**
 * @fileoverview A scheduler for running a task once per week on a specific day and time.
 */

/**
 * @interface WeeklyOptions
 * @description Options for configuring the WeeklyScheduler.
 * @property {number} day - The day of the week to run the task (0=Sunday, 6=Saturday).
 * @property {number} hour - The hour of the day to run the task (0-23).
 * @property {number} [minute=0] - The minute of the hour to run the task (0-59).
 * @property {boolean} [runOnStart=false] - Whether to run the task immediately upon starting the scheduler.
 * @property {string} [timeZone] - The IANA time zone for interpreting the schedule. Defaults to the system's local time zone.
 */
export interface WeeklyOptions {
  day: number; // 0=Sunday ... 6=Saturday in provided time zone (or local if none)
  hour: number; // 0-23
  minute?: number; // 0-59
  runOnStart?: boolean;
  timeZone?: string; // IANA time zone; defaults to local
}

/**
 * @typedef {function} WeeklyTask
 * @description A task to be executed by the scheduler. Can be synchronous or asynchronous.
 */
export type WeeklyTask = () => Promise<void> | void;

/**
 * @class WeeklyScheduler
 * @description A scheduler that runs a given task once per week at a specified day and time.
 */
export class WeeklyScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly opts: WeeklyOptions;
  private readonly task: WeeklyTask;

  /**
   * @constructor
   * @param {WeeklyTask} task - The task to be scheduled.
   * @param {WeeklyOptions} opts - The scheduling options.
   */
  constructor(task: WeeklyTask, opts: WeeklyOptions) {
    this.task = task;
    this.opts = { ...opts, minute: opts.minute ?? 0 };
  }

  /**
   * @method start
   * @description Starts the scheduler. If `runOnStart` is true, the task is executed immediately before scheduling the next run.
   */
  start() {
    if (this.opts.runOnStart) void this.safeRun();
    this.scheduleNext();
  }

  /**
   * @method stop
   * @description Stops the scheduler and clears any pending scheduled tasks.
   */
  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * @private
   * @method scheduleNext
   * @description Calculates the time of the next scheduled run and sets a timeout to execute it.
   */
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

  /**
   * @private
   * @method safeRun
   * @description Executes the scheduled task within a try-catch block to prevent errors from crashing the scheduler.
   */
  private async safeRun() {
    try { await this.task(); } catch {}
  }
}
