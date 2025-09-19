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
    const type = String(req.body?.type || 'lineup').toLowerCase();
    const cm = new ConfigManager();
    const settings = cm.loadAppSettings();
    const leagueKey = normalizeLeagueKeyInput(req.body?.leagueKey || settings.leagueKey || '');
    const teamKey = normalizeTeamKeyInput(leagueKey, req.body?.teamKey || settings.teamKey || '');

    if (!leagueKey || !teamKey) {
      res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey' });
      return;
    }

    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);

    const league = await api.getLeague(leagueKey);
    const rosterEntries = await api.getTeamRosterWithSlots(teamKey);
    const roster = rosterEntries.map((entry: any) => entry.player).filter(Boolean);
    const leagueProfile = cm.loadLeagueProfile(leagueKey);
    const needsSurplus = computeNeedsAndSurplus(roster, league.settings?.rosterPositions || {});

    const baseContext: any = {
      leagueKey,
      teamKey,
      leagueProfile,
      leagueSettings: league.settings,
      rosterWithSlots: rosterEntries,
      needs: needsSurplus.needs,
      surplus: needsSurplus.surplus,
      season: league.season,
      week: league.currentWeek,
      generatedAt: new Date().toISOString(),
    };

    if (type === 'lineup') {
      const preview = GeminiClient.previewLineup(roster, league.settings, baseContext);
      res.json({ ok: true, ...preview });
      return;
    }

    if (type === 'waivers') {
      const maxClaims = Number.isFinite(Number(req.body?.maxClaims)) ? Number(req.body?.maxClaims) : 5;
      let candidates = await api.getWaiverWirePlayers(leagueKey, 25);
      if (!candidates.length) candidates = await api.getFreeAgents(leagueKey, 25);
      const teamInfo = await api.getTeamInfo(teamKey);
      const context = {
        ...baseContext,
        faabBudgetRemaining: teamInfo.faabBalance,
        waiverPriority: teamInfo.waiverPriority,
        availableCount: candidates.length,
      };
      const preview = GeminiClient.previewWaivers(candidates, maxClaims, context);
      res.json({ ok: true, ...preview, faabBalance: teamInfo.faabBalance, waiverPriority: teamInfo.waiverPriority });
      return;
    }

    if (type === 'trade') {
      const theirTeamNumberRaw = req.body?.theirTeamNumber;
      const theirTeamNumber = Number.isFinite(Number(theirTeamNumberRaw)) ? Number(theirTeamNumberRaw) : undefined;
      const teams = await api.getLeagueTeams(leagueKey);
      const myTeamNumber = extractTeamNumber(teamKey);
      let opponent = teams.find((t) => {
        const num = extractTeamNumber(t.key);
        if (theirTeamNumber !== undefined) return num === theirTeamNumber;
        return num !== null && num !== myTeamNumber;
      });
      if (!opponent && teams.length) opponent = teams[0];
      if (!opponent) {
        res.status(404).json({ ok: false, error: 'Unable to determine opponent team' });
        return;
      }
      const opponentRosterEntries = await api.getTeamRosterWithSlots(opponent.key);
      const opponentRoster = opponentRosterEntries.map((entry: any) => entry.player).filter(Boolean);
      const context = {
        ...baseContext,
        opponentTeamKey: opponent.key,
        opponentTeamName: opponent.name,
        opponentRosterWithSlots: opponentRosterEntries,
      };
      const preview = GeminiClient.previewTrade(roster, opponentRoster, context);
      res.json({ ok: true, ...preview, inferredOpponentTeamKey: opponent.key, opponentTeamName: opponent.name });
      return;
    }

    res.status(400).json({ ok: false, error: `Unsupported preview type: ${type}` });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
