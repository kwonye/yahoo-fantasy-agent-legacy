import fs from 'fs';
import path from 'path';

export interface GeminiEntry {
  ts: string;
  system: string;
  user: string;
  response: string;
  inputs?: any;
}

export class GeminiLog {
  private static filePath = path.join(process.cwd(), 'logs', 'gemini.log');

  static record(entry: GeminiEntry): void {
    try {
      const dir = path.dirname(GeminiLog.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(GeminiLog.filePath, JSON.stringify(entry) + '\n', 'utf8');
    } catch {}
  }

  static readLast(limit = 50): GeminiEntry[] {
    try {
      if (!fs.existsSync(GeminiLog.filePath)) return [];
      const lines = fs.readFileSync(GeminiLog.filePath, 'utf8').trim().split('\n').filter(Boolean);
      return lines.slice(-limit).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }

  static clear(): void {
    try {
      const dir = path.dirname(GeminiLog.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(GeminiLog.filePath, '', 'utf8');
    } catch {}
  }
}
