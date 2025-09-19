import type { NextApiRequest, NextApiResponse } from 'next';
import { BotController } from '../../../src/controllers/BotController';
import { ConfigManager } from '../../../src/services/ConfigManager';
import { requireApiAuth } from '../../../src/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  try {
    const cm = new ConfigManager();
    const app = cm.loadAppSettings();
    const leagueKey = String(req.body?.leagueKey || process.env.LEAGUE_KEY || app.leagueKey || '');
    const teamKey = String(req.body?.teamKey || process.env.TEAM_KEY || app.teamKey || '');
    if (!leagueKey || !teamKey) {
      res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey' });
      return;
    }
    const bot = new BotController({ leagueKey, teamKey });
    await bot.runWaivers();
    res.json({ ok: true, waivers: true, leagueKey, teamKey });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
