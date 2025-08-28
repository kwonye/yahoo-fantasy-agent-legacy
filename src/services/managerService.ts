import { getTeamRoster, getMatchups, setLineup, addDropPlayers, proposeTrade, getLeagueFreeAgents, getLeagueTeams } from '../clients/yahooFantasy.js';
import { decideLineup } from '../strategies/lineup.js';
import { decideWaiverAction } from '../strategies/waivers.js';
import { proposeTradeFromContext } from '../strategies/trades.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { extractLeagueTeams, mapFreeAgentsFromLeaguePlayersResponse, mapPlayersFromRosterResponse } from '../clients/yahooParsers.js';
import { getEffectiveLeagueSettings } from '../util/leagueSettings.js';

function toXml(obj: any): string {
  // Minimal XML helper for Yahoo write endpoints; replace with robust lib if needed.
  const wrap = (k: string, v: any) => (typeof v === 'object' ? `<${k}>${toXml(v)}</${k}>` : `<${k}>${String(v)}</${k}>`);
  if (Array.isArray(obj)) return obj.map((v) => toXml(v)).join('');
  return Object.entries(obj)
    .map(([k, v]) => wrap(k, v))
    .join('');
}

export async function runLineup(): Promise<{ applied: boolean; rationale: string }> {
  if (!config.teamKey) throw new Error('YAHOO_TEAM_KEY not set');
  const rosterRaw = await getTeamRoster(config.teamKey);
  const matchup = await getMatchups(config.teamKey);
  const roster = mapPlayersFromRosterResponse(rosterRaw);
  const { effective } = await getEffectiveLeagueSettings();
  const decision = await decideLineup(roster, matchup, effective);
  if (!decision.moves.length) return { applied: false, rationale: decision.rationale };
  // Build XML for lineup changes
  const payload = `<?xml version="1.0" encoding="UTF-8"?>` +
    `<fantasy_content>${toXml({ roster: { coverage_type: 'week', players: { player: decision.moves.map((m) => ({ player_id: m.player_id, position: m.to_position })) } } })}</fantasy_content>`;
  await setLineup(config.teamKey, payload);
  logger.info('Applied lineup moves', decision.moves);
  return { applied: true, rationale: decision.rationale };
}

export async function runWaivers(): Promise<{ applied: boolean; rationale: string } | null> {
  if (!config.teamKey) throw new Error('YAHOO_TEAM_KEY not set');
  if (!config.leagueKey) throw new Error('YAHOO_LEAGUE_KEY required for waivers');
  const [faRaw, rosterRaw] = await Promise.all([
    getLeagueFreeAgents(config.leagueKey, 0, 25),
    getTeamRoster(config.teamKey),
  ]);
  const freeAgents = mapFreeAgentsFromLeaguePlayersResponse(faRaw);
  const roster = mapPlayersFromRosterResponse(rosterRaw);
  const { effective } = await getEffectiveLeagueSettings();
  const decision = await decideWaiverAction(freeAgents, roster, effective);
  if (!decision) return null;
  const payload = `<?xml version="1.0" encoding="UTF-8"?>` +
    `<fantasy_content>${toXml({ transactions: { transaction: { type: 'add/drop', players: { player: [
      { player_id: decision.add_player_id, type: 'add' },
      ...(decision.drop_player_id ? [{ player_id: decision.drop_player_id, type: 'drop' }] : []),
    ] } } } })}</fantasy_content>`;
  await addDropPlayers(config.teamKey, payload);
  logger.info('Submitted waiver move');
  return { applied: true, rationale: decision.rationale };
}

export async function runTrade(): Promise<{ proposed: boolean; message?: string } | null> {
  if (!config.leagueKey || !config.teamKey) throw new Error('YAHOO_LEAGUE_KEY and YAHOO_TEAM_KEY required');
  const myRosterRaw = await getTeamRoster(config.teamKey);
  const myRoster = mapPlayersFromRosterResponse(myRosterRaw);

  const leagueTeamsRaw = await getLeagueTeams(config.leagueKey);
  const teams = extractLeagueTeams(leagueTeamsRaw)
    .filter((t) => t.team_key !== config.teamKey);

  const otherTeams: Array<{ team_key: string; roster: any[] }> = [];
  for (const t of teams) {
    try {
      const rRaw = await getTeamRoster(t.team_key);
      const roster = mapPlayersFromRosterResponse(rRaw);
      otherTeams.push({ team_key: t.team_key, roster });
    } catch (e) {
      logger.warn(`Failed to fetch roster for ${t.team_key}`);
    }
  }

  const { effective } = await getEffectiveLeagueSettings();
  const proposal = await proposeTradeFromContext(myRoster, otherTeams, effective);
  if (!proposal) return null;
  const payload = `<?xml version="1.0" encoding="UTF-8"?>` +
    `<fantasy_content>${toXml({ transactions: { transaction: { type: 'trade', trader_team_key: config.teamKey, trade: {
      partner_team_key: proposal.partner_team_key,
      players: {
        player: [
          ...proposal.offer_player_ids.map((id) => ({ player_id: id, destination_team_key: proposal.partner_team_key })),
          ...proposal.request_player_ids.map((id) => ({ player_id: id, destination_team_key: config.teamKey }))
        ],
      },
      message: proposal.message,
    } } } })}</fantasy_content>`;
  await proposeTrade(config.leagueKey, payload);
  logger.info('Proposed trade');
  return { proposed: true, message: proposal.message };
}
