import type { NextApiRequest, NextApiResponse } from 'next';
import { BotController } from '../../../src/controllers/BotController';
import { ConfigManager } from '../../../src/services/ConfigManager';

// This route is triggered by Vercel Cron (see vercel.json) and can also be invoked manually.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  try {
    const cm = new ConfigManager();
    const app = cm.loadAppSettings();
    const leagueKey = process.env.LEAGUE_KEY || app.leagueKey;
    const teamKey = process.env.TEAM_KEY || app.teamKey;
    if (!leagueKey || !teamKey) {
      res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey (set env or configure in app settings)' });
      return;
    }
    const bot = new BotController({ leagueKey, teamKey });
    await bot.runDaily();
    res.json({ ok: true, ran: true, leagueKey, teamKey });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
