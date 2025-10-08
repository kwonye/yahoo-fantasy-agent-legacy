/**
 * @fileoverview A static utility class for logging interactions with the Gemini API.
 */
import fs from 'fs';
import path from 'path';

/**
 * @interface GeminiEntry
 * @description Represents a single log entry for a Gemini API call.
 * @property {string} ts - The ISO timestamp of the log entry.
 * @property {string} system - The system prompt sent to the API.
 * @property {string} user - The user prompt sent to the API.
 * @property {string} response - The response received from the API.
 * @property {any} [inputs] - Optional additional inputs or context for the API call.
 */
export interface GeminiEntry {
  ts: string;
  system: string;
  user: string;
  response: string;
  inputs?: any;
}

/**
 * @class GeminiLog
 * @description Provides static methods to record, read, and clear logs of Gemini API interactions.
 * This is useful for debugging and reviewing the AI's behavior.
 */
export class GeminiLog {
  private static filePath = path.join(process.cwd(), 'logs', 'gemini.log');

  /**
   * @static
   * @method record
   * @description Records a single Gemini API interaction to the log file.
   * @param {GeminiEntry} entry - The log entry to record.
   */
  static record(entry: GeminiEntry): void {
    try {
      const dir = path.dirname(GeminiLog.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(GeminiLog.filePath, JSON.stringify(entry) + '\n', 'utf8');
    } catch {}
  }

  /**
   * @static
   * @method readLast
   * @description Reads the last N entries from the Gemini log file.
   * @param {number} [limit=50] - The maximum number of log entries to return.
   * @returns {GeminiEntry[]} An array of the most recent log entries.
   */
  static readLast(limit = 50): GeminiEntry[] {
    try {
      if (!fs.existsSync(GeminiLog.filePath)) return [];
      const lines = fs.readFileSync(GeminiLog.filePath, 'utf8').trim().split('\n').filter(Boolean);
      return lines.slice(-limit).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }

  /**
   * @static
   * @method clear
   * @description Clears all entries from the Gemini log file.
   */
  static clear(): void {
    try {
      const dir = path.dirname(GeminiLog.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(GeminiLog.filePath, '', 'utf8');
    } catch {}
  }
}
