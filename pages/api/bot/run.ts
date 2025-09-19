import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../../src/services/ConfigManager';
import { BotController } from '../../../src/controllers/BotController';
import { requireApiAuth } from '../../../src/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;
  try {
    const s = new ConfigManager().loadAppSettings();
    const leagueKey = String(req.body?.leagueKey || s.leagueKey || '');
    const teamKey = String(req.body?.teamKey || s.teamKey || '');
    if (!leagueKey || !teamKey) { res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey' }); return; }
    const bot = new BotController({ leagueKey, teamKey });
    await bot.runDaily();
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ ok: false, error: err?.message || String(err) }); }
}
