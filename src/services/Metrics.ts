export type CounterMap = Record<string, number>;

export class Metrics {
  counters: CounterMap = {};
  timings: Record<string, number[]> = {};

  inc(name: string, by = 1): void {
    this.counters[name] = (this.counters[name] ?? 0) + by;
  }

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

