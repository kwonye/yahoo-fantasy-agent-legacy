/**
 * @fileoverview A simple in-memory metrics collector for counters and timings.
 */

/**
 * @typedef {Record<string, number>} CounterMap
 * @description A map of counter names to their numeric values.
 */
export type CounterMap = Record<string, number>;

/**
 * @class Metrics
 * @description A class for collecting simple in-memory metrics, such as counters and timings.
 * This is useful for performance monitoring and diagnostics.
 */
export class Metrics {
  /**
   * @property {CounterMap} counters - A map to store counter metrics.
   */
  counters: CounterMap = {};
  /**
   * @property {Record<string, number[]>} timings - A map to store timing metrics, where each key holds an array of durations in milliseconds.
   */
  timings: Record<string, number[]> = {};

  /**
   * @method inc
   * @description Increments a named counter.
   * @param {string} name - The name of the counter.
   * @param {number} [by=1] - The amount to increment the counter by.
   */
  inc(name: string, by = 1): void {
    this.counters[name] = (this.counters[name] ?? 0) + by;
  }

  /**
   * @method time
   * @description Measures the execution time of a function (synchronous or asynchronous).
   * @template T - The return type of the function being timed.
   * @param {string} name - The name of the timing metric.
   * @param {() => Promise<T> | T} fn - The function to execute and time.
   * @returns {Promise<T> | T} The result of the executed function.
   */
  time<T>(name: string, fn: () => Promise<T> | T): Promise<T> | T {
    const start = Date.now();
    const finalize = (res: T) => {
      const dur = Date.now() - start;
      if (!this.timings[name]) this.timings[name] = [];
      this.timings[name].push(dur);
      return res;
    };
    const r = fn();
    if (r && typeof (r as any).then === 'function') {
      return (r as Promise<T>).then(finalize);
    }
    return finalize(r as T);
  }
}

