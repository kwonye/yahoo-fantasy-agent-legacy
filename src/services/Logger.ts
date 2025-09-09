type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  level?: LogLevel;
  service?: string;
}

export class Logger {
  private levelPriority: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  private threshold: number;
  private service?: string;

  constructor(opts: LoggerOptions = {}) {
    const level = opts.level ?? (process.env.LOG_LEVEL as LogLevel) ?? 'info';
    this.threshold = this.levelPriority[level] ?? 20;
    this.service = opts.service;
  }

  debug(msg: string, meta?: any) { this.log('debug', msg, meta); }
  info(msg: string, meta?: any) { this.log('info', msg, meta); }
  warn(msg: string, meta?: any) { this.log('warn', msg, meta); }
  error(msg: string, meta?: any) { this.log('error', msg, meta); }

  private log(level: LogLevel, msg: string, meta?: any) {
    if ((this.levelPriority[level] ?? 999) < this.threshold) return;
    const entry: any = {
      ts: new Date().toISOString(),
      level,
      msg,
    };
    if (this.service) entry.service = this.service;
    if (meta !== undefined) entry.meta = safeJson(meta);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
  }
}

function safeJson(obj: any) {
  try { return JSON.parse(JSON.stringify(obj)); } catch { return String(obj); }
}

