// runtime requires used inside handler to import compiled services

function normalizeLeagueKeyInput(raw: string) {
  const r = String(raw || '').trim(); if (!r) return ''; if (/^nfl\.l\.\d+$/i.test(r)) return r; if (/^\d+$/.test(r)) return `nfl.l.${r}`; const m = r.match(/(\d{4,})/); if (m) return `nfl.l.${m[1]}`; return r;
}

function normalizeTeamKeyInput(leagueKeyMaybe: string, input: any) {
  const lk = normalizeLeagueKeyInput(leagueKeyMaybe);
  const raw = String(input || '').trim(); if (!raw) return ''; if (/^nfl\.l\.\d+\.t\.\d+$/i.test(raw)) return raw; if (/^\d+$/.test(raw)) return lk ? `${lk}.t.${raw}` : raw; const m = raw.match(/(?:^|\.)t\.(\d+)$/i); if (m && lk) return `${lk}.t.${m[1]}`; return raw;
}

import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../src/services/ConfigManager';
import { YahooOAuthClient } from '../../src/services/YahooOAuthClient';
import { YahooApiService } from '../../src/services/YahooApiService';
import { requireApiAuth } from '../../src/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;
  try {
    const cm = new ConfigManager();
    const s = cm.loadAppSettings();
    const teamKey = normalizeTeamKeyInput(s.leagueKey, req.query.teamKey || s.teamKey);
    if (!teamKey) { res.status(400).json({ ok: false, error: 'Missing teamKey' }); return; }
    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);
    const entries = await api.getTeamRosterWithSlots(teamKey as string);
    const sanitized = entries.map((e: any) => ({ slot: e.slot, player: { id: e.player.id, name: e.player.name, position: e.player.position, team: e.player.team, status: e.player.status } }));
    res.json({ ok: true, roster: sanitized });
  } catch (err: any) { res.status(500).json({ ok: false, error: err?.message || String(err) }); }
}
