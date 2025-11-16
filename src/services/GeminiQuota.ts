import fs from 'fs';
import path from 'path';
import { ConfigManager } from './ConfigManager';

export class GeminiQuota {
  private static instance: GeminiQuota;
  private readonly filePath: string;
  private readonly limit: number;

  private constructor(limit?: number, filePath?: string) {
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}
    }
    this.filePath = filePath ?? path.join(logsDir, 'gemini_quota.json');
    const configManager = new ConfigManager();
    const geminiCreds = configManager.loadGeminiCredentials();
    const envLimit = parseInt(process.env.MAX_GEMINI_CALLS_PER_DAY || '', 10);
    this.limit = geminiCreds?.geminiQuota ?? (Number.isFinite(envLimit) && envLimit > 0 ? envLimit : (limit ?? 200));
  }

  public static getInstance(): GeminiQuota {
    if (!GeminiQuota.instance) {
      GeminiQuota.instance = new GeminiQuota();
    }
    return GeminiQuota.instance;
  }

  private todayKey(): string {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

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

  private write(data: { date: string; count: number }) {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch {}
  }

  reset() {
    this.write({ date: this.todayKey(), count: 0 });
  }

  getLimit(): number { return this.limit; }

  getRemaining(): number {
    const { count } = this.read();
    return Math.max(0, this.limit - count);
  }

  tryConsume(n = 1): boolean {
    const cur = this.read();
    if (cur.count + n > this.limit) return false;
    cur.count += n;
    this.write(cur);
    return true;
  }
}

