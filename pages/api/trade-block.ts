import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../src/services/ConfigManager';
import { YahooOAuthClient } from '../../src/services/YahooOAuthClient';
import { YahooApiService } from '../../src/services/YahooApiService';
import { requireApiAuth } from '../../src/lib/auth';
import { normalizeLeagueKeyInput, normalizeTeamKeyInput } from '../../src/lib/yahooKeys';
import { computeNeedsAndSurplus } from '../../src/lib/rosterAnalysis';

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

    if (!leagueKey || !teamKey) {
      res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey' });
      return;
    }

    const force = Boolean(req.query.force);
    void force; // Placeholder for potential caching controls

    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);
    const league = await api.getLeague(leagueKey);
    const rosterEntries = await api.getTeamRosterWithSlots(teamKey);
    const roster = rosterEntries.map((entry: any) => entry.player).filter(Boolean);

    const analysis = computeNeedsAndSurplus(roster, league.settings?.rosterPositions || {});

    const reasoningParts: string[] = [];
    if (analysis.needs.length) {
      reasoningParts.push(`Needs help at ${analysis.needs.join(', ')}`);
    }
    if (analysis.surplus.length) {
      reasoningParts.push(`Surplus depth at ${analysis.surplus.join(', ')}`);
    }
    if (!reasoningParts.length) {
      reasoningParts.push('Roster distribution aligns with league requirements. Focus on overall talent upgrades.');
    }

    res.json({
      ok: true,
      needs: analysis.needs,
      surplus: analysis.surplus,
      reasoning: reasoningParts.join('. '),
      counts: analysis.counts,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
