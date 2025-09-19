import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../../src/services/ConfigManager';
import { YahooOAuthClient } from '../../../src/services/YahooOAuthClient';
import { YahooApiService } from '../../../src/services/YahooApiService';
import { requireApiAuth } from '../../../src/lib/auth';
import { normalizeLeagueKeyInput, normalizeTeamKeyInput } from '../../../src/lib/yahooKeys';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  try {
    const cm = new ConfigManager();
    const settings = cm.loadAppSettings();
    const leagueKey = normalizeLeagueKeyInput(req.query.leagueKey || settings.leagueKey || '');
    const teamKey = normalizeTeamKeyInput(leagueKey, req.query.teamKey || settings.teamKey || '');
    const countRaw = Array.isArray(req.query.count) ? req.query.count[0] : req.query.count;
    const count = Number.isFinite(Number(countRaw)) ? Number(countRaw) : 100;

    if (!leagueKey) {
      res.status(400).json({ ok: false, error: 'Missing leagueKey' });
      return;
    }

    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);
    const dbg: { tried: string[] } = { tried: [] };
    const items = await api.getAllTransactionsNormalized(leagueKey, teamKey || undefined, count, dbg);
    res.json({ ok: true, count: items.length, items, tried: dbg.tried });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
