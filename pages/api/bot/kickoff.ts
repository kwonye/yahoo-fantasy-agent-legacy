import type { NextApiRequest, NextApiResponse } from 'next';
import { BotController } from '../../../src/controllers/BotController';
import { ConfigManager } from '../../../src/services/ConfigManager';
import { DateTime } from 'luxon';
import { loadKickoffSchedule } from '../../../src/data/kickoffSchedule';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  try {
    const cm = new ConfigManager();
    const app = cm.loadAppSettings();
    if (!app.kickoffEnabled) {
      res.json({ ok: true, kickoff: false, reason: 'kickoff automation disabled' });
      return;
    }

    const preMinutes = [90, 60, 30];
    const toleranceMs = 2 * 60 * 1000; // 2 minutes
    const nowUtc = DateTime.utc();
    const schedule = loadKickoffSchedule();

    // If explicit schedule provided, use it; else fallback to canonical windows (America/New_York)
    let candidateKickoffs: DateTime[] = [];
    if (schedule.length > 0) {
      candidateKickoffs = schedule
        .map(g => { try { return DateTime.fromISO(g.startISO, { zone: 'utc' }).toUTC(); } catch { return null; } })
        .filter((d): d is DateTime => !!d && d.isValid && d > nowUtc.minus({ minutes: 5 }));
    } else {
      const zone = 'America/New_York';
      const nowLocal = nowUtc.setZone(zone);
      const windows = [
        { dow: 4, hh: 20, mm: 15 },
        { dow: 0, hh: 9,  mm: 30 },
        { dow: 0, hh: 13, mm: 0  },
        { dow: 0, hh: 16, mm: 5  },
        { dow: 0, hh: 16, mm: 25 },
        { dow: 0, hh: 20, mm: 20 },
        { dow: 1, hh: 20, mm: 15 },
      ];
      candidateKickoffs = windows.map(w => {
        const currDow0 = nowLocal.weekday % 7;
        let d = nowLocal.set({ hour: w.hh, minute: w.mm, second: 0, millisecond: 0 });
        if ((nowLocal.weekday % 7) !== w.dow) {
          const delta = (w.dow - currDow0 + 7) % 7;
          d = d.plus({ days: delta });
        }
        if (d < nowLocal) d = d.plus({ days: 7 });
        return d.toUTC();
      });
    }

    // Determine if we are within tolerance of any pre-minute target
    const match = candidateKickoffs.find(k => {
      return preMinutes.some(pm => {
        const target = k.minus({ minutes: pm });
        const diff = Math.abs(target.toMillis() - nowUtc.toMillis());
        return diff <= toleranceMs;
      });
    });

    if (!match) {
      res.json({ ok: true, kickoff: false, reason: 'outside_kickoff_windows' });
      return;
    }
    const leagueKey = process.env.LEAGUE_KEY || app.leagueKey;
    const teamKey = process.env.TEAM_KEY || app.teamKey;
    if (!leagueKey || !teamKey) {
      res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey' });
      return;
    }
  const bot = new BotController({ leagueKey, teamKey });
  await bot.runKickoffCheck();
  res.json({ ok: true, kickoff: true, leagueKey, teamKey, targetKickoff: match.toISO(), ranAt: nowUtc.toISO() });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
