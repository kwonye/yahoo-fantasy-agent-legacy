import fs from 'fs';
import path from 'path';

const AUDIT_PATH = path.join(process.cwd(), 'logs', 'audit.log');

export interface AuditEvent {
  type?: string;
  ts?: string;
  action?: string;
  decision?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

export function readAuditLog(limit = 500): AuditEvent[] {
  try {
    if (!fs.existsSync(AUDIT_PATH)) return [];
    const raw = fs.readFileSync(AUDIT_PATH, 'utf8');
    if (!raw.trim()) return [];
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const slice = limit > 0 ? lines.slice(-limit) : lines;
    const events: AuditEvent[] = [];
    for (const line of slice) {
      try {
        const parsed = JSON.parse(line);
        events.push(parsed);
      } catch {
        // ignore malformed lines
      }
    }
    return events;
  } catch {
    return [];
  }
}

export function clearAuditLog(): void {
  try {
    const dir = path.dirname(AUDIT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AUDIT_PATH, '', 'utf8');
  } catch {
    // swallow I/O issues to avoid crashing API handlers
  }
}

export function computeAuditMetrics(events: AuditEvent[]) {
  const result = {
    decisions: 0,
    actions: 0,
    errors: 0,
    byType: {} as Record<string, number>,
  };

  for (const event of events) {
    const type = String(event?.type || '').toLowerCase();
    if (type === 'decision') result.decisions += 1;
    if (type === 'action') {
      result.actions += 1;
      const key = String(event?.action || 'unknown');
      result.byType[key] = (result.byType[key] ?? 0) + 1;
    }
    if (type === 'error') result.errors += 1;
  }

  return result;
}
