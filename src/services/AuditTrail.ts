/**
 * @fileoverview Service for recording audit trail events to a log file.
 */
import fs from 'fs';
import path from 'path';
import { BotDecision } from '../models/Decision';

/**
 * @interface AuditTrailOptions
 * @description Options for configuring the AuditTrail service.
 * @property {string} [dir] - The directory to store the log file. Defaults to './logs'.
 * @property {string} [filename] - The name of the log file. Defaults to 'audit.log'.
 */
export interface AuditTrailOptions {
  dir?: string; // default ./logs
  filename?: string; // default audit.log
}

/**
 * @class AuditTrail
 * @description Service for recording audit trail events like decisions, errors, and actions to a log file.
 */
export class AuditTrail {
  private readonly filePath: string;

  /**
   * @constructor
   * @param {AuditTrailOptions} [opts={}] - Options for the audit trail.
   */
  constructor(opts: AuditTrailOptions = {}) {
    const dir = opts.dir ?? path.join(process.cwd(), 'logs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, opts.filename ?? 'audit.log');
  }

  /**
   * @method recordDecision
   * @description Records a bot decision in the audit trail.
   * @param {BotDecision} decision - The decision to record.
   */
  recordDecision(decision: BotDecision): void {
    const entry = { type: 'decision', ts: new Date().toISOString(), decision };
    fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n', { encoding: 'utf8' });
  }

  /**
   * @method recordError
   * @description Records an error in the audit trail.
   * @param {Error} err - The error to record.
   * @param {any} [context] - Optional context about the error.
   */
  recordError(err: Error, context?: any): void {
    const entry = { type: 'error', ts: new Date().toISOString(), error: { message: err.message, stack: err.stack }, context };
    fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n', { encoding: 'utf8' });
  }

  /**
   * @method recordAction
   * @description Records a generic action in the audit trail.
   * @param {string} action - The name of the action.
   * @param {any} [details] - Optional details about the action.
   */
  recordAction(action: string, details?: any): void {
    const entry = { type: 'action', ts: new Date().toISOString(), action, details };
    fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n', { encoding: 'utf8' });
  }
}
