import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../../src/services/ConfigManager';
import { YahooOAuthClient } from '../../../src/services/YahooOAuthClient';
import { YahooApiService } from '../../../src/services/YahooApiService';
import { GeminiClient } from '../../../src/services/GeminiClient';
import { requireApiAuth } from '../../../src/lib/auth';
import { normalizeLeagueKeyInput, normalizeTeamKeyInput, extractTeamNumber } from '../../../src/lib/yahooKeys';
import { computeNeedsAndSurplus } from '../../../src/lib/rosterAnalysis';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  try {
    const cm = new ConfigManager();
    const settings = cm.loadAppSettings();
    const leagueKey = normalizeLeagueKeyInput(req.body?.leagueKey || settings.leagueKey || '');
    const teamKey = normalizeTeamKeyInput(leagueKey, req.body?.teamKey || settings.teamKey || '');
    const tradeId = String(req.body?.tradeId || '').trim();

    if (!leagueKey || !teamKey || !tradeId) {
      res.status(400).json({ ok: false, error: 'Missing leagueKey, teamKey, or tradeId' });
      return;
    }

    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);

    const trade = await api.getTransactionById(leagueKey, tradeId);
    if (!trade) {
      res.status(404).json({ ok: false, error: 'Trade not found' });
      return;
    }

    const league = await api.getLeague(leagueKey);
    const rosterEntries = await api.getTeamRosterWithSlots(teamKey);
    const roster = rosterEntries.map((entry: any) => entry.player).filter(Boolean);
    const leagueProfile = cm.loadLeagueProfile(leagueKey);

    const { needs, surplus } = computeNeedsAndSurplus(roster, league.settings?.rosterPositions || {});

    let gemini: GeminiClient;
    try {
      gemini = new GeminiClient();
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'Gemini not configured' });
      return;
    }

    const decision = await gemini.evaluateIncomingTradeOffer(
      roster,
      league.settings,
      needs,
      surplus,
      trade.moves ?? [],
      teamKey,
      leagueProfile || undefined
    );

    // Add helper metadata for UI convenience
    const myTeamNumber = extractTeamNumber(teamKey);
    const counterpartyKeys = Array.isArray(trade.teamKeys) ? trade.teamKeys.filter((k: string) => extractTeamNumber(k) !== myTeamNumber) : [];

    res.json({ ok: true, decision, trade: { id: tradeId, moves: trade.moves, teamKeys: trade.teamKeys }, counterpartyKeys });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
