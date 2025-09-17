import fs from 'fs';
import path from 'path';

export interface KickoffGame {
  id?: string;
  startISO: string; // ISO8601 instant (UTC or with offset)
  note?: string; // optional description (e.g., "Week 5 London")
}

export function loadKickoffSchedule(): KickoffGame[] {
  // User can place a season schedule at config/nfl_schedule.json
  // Format: [{ "startISO": "2025-09-07T17:00:00Z", "note": "Week 1 1pm" }, ...]
  // Only minimal validation is done here.
  const candidates = [
    path.join(process.cwd(), 'config', 'nfl_schedule.json'),
    path.join(process.cwd(), 'config', 'kickoff_schedule.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          return arr.filter(g => g && typeof g.startISO === 'string');
        }
      }
    } catch { /* ignore and try next */ }
  }
  return [];
}
