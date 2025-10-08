/**
 * @fileoverview A simple JSON logger for the application.
 */

/**
 * @typedef {'debug' | 'info' | 'warn' | 'error'} LogLevel
 * @description The available log levels.
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * @interface LoggerOptions
 * @description Options for configuring the Logger.
 * @property {LogLevel} [level] - The minimum log level to output. Defaults to 'info' or the `LOG_LEVEL` environment variable.
 * @property {string} [service] - An optional service name to include in log entries.
 */
export interface LoggerOptions {
  level?: LogLevel;
  service?: string;
}

/**
 * @class Logger
 * @description A simple logger that outputs structured JSON logs to the console.
 * It supports different log levels and can be configured with a service name.
 */
export class Logger {
  private levelPriority: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  private threshold: number;
  private service?: string;

  /**
   * @constructor
   * @param {LoggerOptions} [opts={}] - Configuration options for the logger.
   */
  constructor(opts: LoggerOptions = {}) {
    const level = opts.level ?? (process.env.LOG_LEVEL as LogLevel) ?? 'info';
    this.threshold = this.levelPriority[level] ?? 20;
    this.service = opts.service;
  }

  /**
   * @method debug
   * @description Logs a message at the 'debug' level.
   * @param {string} msg - The message to log.
   * @param {any} [meta] - Optional metadata to include in the log entry.
   */
  debug(msg: string, meta?: any) { this.log('debug', msg, meta); }

  /**
   * @method info
   * @description Logs a message at the 'info' level.
   * @param {string} msg - The message to log.
   * @param {any} [meta] - Optional metadata to include in the log entry.
   */
  info(msg: string, meta?: any) { this.log('info', msg, meta); }

  /**
   * @method warn
   * @description Logs a message at the 'warn' level.
   * @param {string} msg - The message to log.
   * @param {any} [meta] - Optional metadata to include in the log entry.
   */
  warn(msg: string, meta?: any) { this.log('warn', msg, meta); }

  /**
   * @method error
   * @description Logs a message at the 'error' level.
   * @param {string} msg - The message to log.
   * @param {any} [meta] - Optional metadata to include in the log entry.
   */
  error(msg: string, meta?: any) { this.log('error', msg, meta); }

  /**
   * @private
   * @method log
   * @description The core logging method. It checks the log level and outputs a JSON log entry to the console.
   * @param {LogLevel} level - The level of the log message.
   * @param {string} msg - The message to log.
   * @param {any} [meta] - Optional metadata.
   */
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

/**
 * @private
 * @function safeJson
 * @description Safely converts an object to a JSON-compatible representation,
 * falling back to a string if JSON serialization fails.
 * @param {any} obj - The object to process.
 * @returns {any} The JSON-safe object or a string representation.
 */
function safeJson(obj: any) {
  try { return JSON.parse(JSON.stringify(obj)); } catch { return String(obj); }
}

