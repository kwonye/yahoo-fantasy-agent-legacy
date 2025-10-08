/**
 * @fileoverview Manages the daily API call quota for the Gemini API.
 */
import fs from 'fs';
import path from 'path';

/**
 * @class GeminiQuota
 * @description Tracks and enforces a daily limit on the number of calls made to the Gemini API.
 * The quota resets automatically each day.
 */
export class GeminiQuota {
  private readonly filePath: string;
  private readonly limit: number;

  /**
   * @constructor
   * @param {number} [limit=50] - The daily API call limit. Can be overridden by the `MAX_GEMINI_CALLS_PER_DAY` environment variable.
   * @param {string} [filePath] - The path to the file used to persist the quota count.
   */
  constructor(limit?: number, filePath?: string) {
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}
    }
    this.filePath = filePath ?? path.join(logsDir, 'gemini_quota.json');
    const envLimit = parseInt(process.env.MAX_GEMINI_CALLS_PER_DAY || '', 10);
    this.limit = Number.isFinite(envLimit) && envLimit > 0 ? envLimit : (limit ?? 50);
  }

  /**
   * @private
   * @method todayKey
   * @description Generates a string key for the current date in 'YYYY-MM-DD' format.
   * @returns {string} The date key for today.
   */
  private todayKey(): string {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * @private
   * @method read
   * @description Reads the current quota count from the persistent storage file. If the stored date is not today, it resets the count.
   * @returns {{ date: string; count: number }} The current date and API call count.
   */
  private read(): { date: string; count: number } {
    try {
      if (!fs.existsSync(this.filePath)) return { date: this.todayKey(), count: 0 };
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return { date: this.todayKey(), count: 0 };
      const date = String((obj as any).date || '');
      const count = Number((obj as any).count ?? 0) || 0;
      const today = this.todayKey();
      if (date !== today) return { date: today, count: 0 };
      return { date, count };
    } catch {
      return { date: this.todayKey(), count: 0 };
    }
  }

  /**
   * @private
   * @method write
   * @description Writes the current quota data to the persistent storage file.
   * @param {{ date: string; count: number }} data - The quota data to write.
   */
  private write(data: { date: string; count: number }) {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch {}
  }

  /**
   * @method getLimit
   * @description Returns the configured daily API call limit.
   * @returns {number} The daily limit.
   */
  getLimit(): number { return this.limit; }

  /**
   * @method getRemaining
   * @description Calculates the number of remaining API calls for the current day.
   * @returns {number} The number of remaining calls.
   */
  getRemaining(): number {
    const { count } = this.read();
    return Math.max(0, this.limit - count);
  }

  /**
   * @method tryConsume
   * @description Attempts to consume one or more API calls from the quota. If the call would exceed the limit, it fails.
   * @param {number} [n=1] - The number of calls to consume.
   * @returns {boolean} `true` if the calls were successfully consumed, `false` otherwise.
   */
  tryConsume(n = 1): boolean {
    const cur = this.read();
    if (cur.count + n > this.limit) return false;
    cur.count += n;
    this.write(cur);
    return true;
  }
}

