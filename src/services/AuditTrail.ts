import fs from 'fs';
import path from 'path';
import { BotDecision } from '../models/Decision';

export interface AuditTrailOptions {
  dir?: string; // default ./logs
  filename?: string; // default audit.log
}

export class AuditTrail {
  private readonly filePath: string;

  constructor(opts: AuditTrailOptions = {}) {
    const dir = opts.dir ?? path.join(process.cwd(), 'logs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, opts.filename ?? 'audit.log');
  }

  recordDecision(decision: BotDecision): void {
    const entry = { type: 'decision', ts: new Date().toISOString(), decision };
    fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n', { encoding: 'utf8' });
  }

  recordError(err: Error, context?: any): void {
    const entry = { type: 'error', ts: new Date().toISOString(), error: { message: err.message, stack: err.stack }, context };
    fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n', { encoding: 'utf8' });
  }

  recordAction(action: string, details?: any): void {
    const entry = { type: 'action', ts: new Date().toISOString(), action, details };
    fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n', { encoding: 'utf8' });
  }
}
