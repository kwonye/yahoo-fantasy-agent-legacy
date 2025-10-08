/**
 * @fileoverview A simple daily scheduler for running tasks at a specific time.
 */

/**
 * @interface ScheduleOptions
 * @description Options for configuring the Scheduler.
 * @property {number} hour - The hour of the day (0-23) to run the task, interpreted in the specified time zone.
 * @property {number} [minute=0] - The minute of the hour (0-59) to run the task.
 * @property {boolean} [runOnStart=false] - Whether to run the task immediately upon starting the scheduler.
 * @property {string} [timeZone] - The IANA time zone to use (e.g., 'America/New_York'). Defaults to the system's local time zone.
 */
export interface ScheduleOptions {
  hour: number; // 0-23 in provided time zone (or local if none)
  minute?: number; // 0-59
  runOnStart?: boolean;
  timeZone?: string; // IANA time zone (e.g., 'America/New_York'); defaults to local
}

/**
 * @typedef {function} Task
 * @description The task to be executed by the scheduler. Can be synchronous or asynchronous.
 */
export type Task = () => Promise<void> | void;

/**
 * @class Scheduler
 * @description A simple scheduler that runs a given task once per day at a specified time.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly opts: ScheduleOptions;
  private readonly task: Task;

  /**
   * @constructor
   * @param {Task} task - The task to be scheduled.
   * @param {ScheduleOptions} opts - The scheduling options.
   */
  constructor(task: Task, opts: ScheduleOptions) {
    this.task = task;
    this.opts = { ...opts, minute: opts.minute ?? 0 };
  }

  /**
   * @method start
   * @description Starts the scheduler. If `runOnStart` is true, it runs the task immediately and then schedules the next run.
   */
  start() {
    if (this.opts.runOnStart) {
      void this.safeRun();
    }
    this.scheduleNext();
  }

  /**
   * @method stop
   * @description Stops the scheduler and clears any pending tasks.
   */
  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * @private
   * @method scheduleNext
   * @description Calculates the delay until the next scheduled run time and sets a timeout.
   */
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

  /**
   * @private
   * @method safeRun
   * @description Executes the task within a try-catch block to prevent the scheduler from crashing on an error.
   */
  private async safeRun() {
    try {
      await this.task();
    } catch (e) {
      // Swallow to avoid crashing scheduler; caller should log in task
    }
  }
}
