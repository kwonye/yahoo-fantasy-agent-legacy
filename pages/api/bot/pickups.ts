import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../../src/services/ConfigManager';
import { BotController } from '../../../src/controllers/BotController';
import { requireApiAuth } from '../../../src/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  try {
    const cm = new ConfigManager();
    const app = cm.loadAppSettings();
    const leagueKey = String(req.body?.leagueKey || app.leagueKey || '');
    const teamKey = String(req.body?.teamKey || app.teamKey || '');

    if (!leagueKey || !teamKey) {
      res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey' });
      return;
    }

    const bot = new BotController({ leagueKey, teamKey });
    await bot.runPickups();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
