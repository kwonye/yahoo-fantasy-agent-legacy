import type { NextApiRequest, NextApiResponse } from 'next';
import { DateTime } from 'luxon';
import { ConfigManager } from '../../../src/services/ConfigManager';
import { loadKickoffSchedule } from '../../../src/data/kickoffSchedule';
import { requireApiAuth } from '../../../src/lib/auth';

const FALLBACK_WINDOWS = [
  { dow: 4, hh: 20, mm: 15, note: 'Thursday Night Football' },
  { dow: 0, hh: 9, mm: 30, note: 'International (London) window' },
  { dow: 0, hh: 13, mm: 0, note: 'Sunday Early' },
  { dow: 0, hh: 16, mm: 5, note: 'Sunday Afternoon (4:05)' },
  { dow: 0, hh: 16, mm: 25, note: 'Sunday Afternoon (4:25)' },
  { dow: 0, hh: 20, mm: 20, note: 'Sunday Night Football' },
  { dow: 1, hh: 20, mm: 15, note: 'Monday Night Football' },
];

const PRE_MINUTES = [90, 60, 30];

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;

  try {
    const cm = new ConfigManager();
    const app = cm.loadAppSettings();
    const nowUtc = DateTime.utc();

    const waiver = buildWaiverPreview(app, nowUtc);
    const kickoff = buildKickoffPreview(app, nowUtc);

    res.json({ ok: true, waiver, kickoff });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}

function buildWaiverPreview(app: any, nowUtc: DateTime) {
  const enabled = Boolean(app?.waiverAutomationEnabled);
  const day = Number.isFinite(app?.waiverDay) ? Number(app.waiverDay) : 2; // Tuesday
  const hour = Number.isFinite(app?.waiverHour) ? Number(app.waiverHour) : 7;
  const minute = Number.isFinite(app?.waiverMinute) ? Number(app.waiverMinute) : 0;
  const zone = 'America/New_York';
  const nowLocal = nowUtc.setZone(zone);
  const next = computeNextOccurrence(nowLocal, day, hour, minute);
  return {
    enabled,
    source: 'settings',
    nextRunISO: enabled && next ? next.toUTC().toISO() : null,
  };
}

function buildKickoffPreview(app: any, nowUtc: DateTime) {
  const enabled = Boolean(app?.kickoffEnabled);
  if (!enabled) {
    return { enabled: false, upcoming: [] as any[] };
  }

  const schedule = loadKickoffSchedule();
  const tasks: Array<{ runAtISO: string; kickoffISO: string; preMinutes: number; note?: string }> = [];
  const now = nowUtc;

  if (Array.isArray(schedule) && schedule.length > 0) {
    for (const game of schedule) {
      const kickoff = parseDate(game.startISO);
      if (!kickoff || kickoff.toMillis() <= now.toMillis()) continue;
      for (const pre of PRE_MINUTES) {
        const runTime = kickoff.minus({ minutes: pre });
        if (runTime <= now) continue;
        tasks.push({
          runAtISO: runTime.toISO(),
          kickoffISO: kickoff.toISO(),
          preMinutes: pre,
          note: game.note,
        });
      }
    }
  } else {
    const zone = 'America/New_York';
    const nowLocal = nowUtc.setZone(zone);
    for (const window of FALLBACK_WINDOWS) {
      for (const pre of PRE_MINUTES) {
        let kickoff = computeNextOccurrence(nowLocal, window.dow, window.hh, window.mm);
        if (!kickoff) continue;
        kickoff = kickoff.setZone(zone);
        const runTime = kickoff.minus({ minutes: pre });
        if (runTime <= nowLocal) continue;
        tasks.push({
          runAtISO: runTime.toUTC().toISO(),
          kickoffISO: kickoff.toUTC().toISO(),
          preMinutes: pre,
          note: window.note,
        });
      }
    }
  }

  tasks.sort((a, b) => DateTime.fromISO(a.runAtISO).toMillis() - DateTime.fromISO(b.runAtISO).toMillis());
  return { enabled: true, upcoming: tasks.slice(0, 20) };
}

function computeNextOccurrence(now: DateTime, dow0: number, hour: number, minute: number): DateTime | null {
  if (!now.isValid) return null;
  const targetDow = ((dow0 % 7) + 7) % 7;
  const currDow0 = now.weekday % 7; // Luxon: Mon=1..Sun=7
  let delta = (targetDow - currDow0 + 7) % 7;
  let next = now.plus({ days: delta }).set({ hour, minute, second: 0, millisecond: 0 });
  if (next <= now) {
    next = next.plus({ days: 7 });
  }
  return next;
}

function parseDate(iso: string | undefined) {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso, { zone: 'utc' });
  return dt.isValid ? dt : null;
}
