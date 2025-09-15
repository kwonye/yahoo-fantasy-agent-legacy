function normalizeLeagueKeyInput(raw: string) { const r = String(raw || '').trim(); if (!r) return ''; if (/^nfl\.l\.\d+$/i.test(r)) return r; if (/^\d+$/.test(r)) return `nfl.l.${r}`; const m = r.match(/(\d{4,})/); if (m) return `nfl.l.${m[1]}`; return r; }

import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../src/services/ConfigManager';
import { YahooOAuthClient } from '../../src/services/YahooOAuthClient';
import { YahooApiService } from '../../src/services/YahooApiService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const cm = new ConfigManager();
    const s = cm.loadAppSettings();
    const leagueKey = normalizeLeagueKeyInput(String(req.query.leagueKey || s.leagueKey || ''));
    if (!leagueKey) { res.status(400).json({ ok: false, error: 'Missing leagueKey' }); return; }
    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);
    const league = await api.getLeague(leagueKey);
    res.json({ ok: true, league });
  } catch (err: any) { res.status(500).json({ ok: false, error: err?.message || String(err) }); }
}
