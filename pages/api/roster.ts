// runtime requires used inside handler to import compiled services

import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../src/services/ConfigManager';
import { YahooOAuthClient } from '../../src/services/YahooOAuthClient';
import { YahooApiService } from '../../src/services/YahooApiService';
import { requireApiAuth } from '../../src/lib/auth';
import { normalizeLeagueKeyInput, normalizeTeamKeyInput } from '../../src/lib/yahooKeys';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;
  try {
    const cm = new ConfigManager();
    const s = cm.loadAppSettings();
    const leagueKey = normalizeLeagueKeyInput(req.query.leagueKey || s.leagueKey);
    const teamKey = normalizeTeamKeyInput(leagueKey, req.query.teamKey || s.teamKey);
    if (!teamKey) { res.status(400).json({ ok: false, error: 'Missing teamKey' }); return; }
    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);
    const entries = await api.getTeamRosterWithSlots(teamKey as string);
    const sanitized = entries.map((e: any) => ({ slot: e.slot, player: { id: e.player.id, name: e.player.name, position: e.player.position, team: e.player.team, status: e.player.status } }));
    res.json({ ok: true, roster: sanitized });
  } catch (err: any) { res.status(500).json({ ok: false, error: err?.message || String(err) }); }
}
