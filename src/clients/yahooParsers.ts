import { Player } from '../strategies/types.js';
import { logger } from '../logger.js';

function asArray<T>(x: T | T[] | undefined | null): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function readPositions(obj: any): string[] {
  const ep = obj?.eligible_positions;
  if (!ep) return [];
  const arr = asArray(ep.position ?? ep);
  return arr.filter(Boolean).map((p: any) => (typeof p === 'string' ? p : String(p)));
}

function mapOnePlayer(core: any): Player | null {
  const playerId = core?.player_id ?? core?.[0]?.player_id;
  const name = core?.name?.full ?? core?.name ?? core?.[0]?.name?.full;
  if (!playerId || !name) return null;
  const eligible_positions = readPositions(core);
  const team = core?.editorial_team_abbr ?? core?.editorial_team_full_name;
  const status = core?.status;
  const points = Number(core?.player_points?.total ?? core?.player_points?.[0]?.total ?? core?.points);
  return {
    player_id: String(playerId),
    name: String(name),
    eligible_positions,
    team: team ? String(team) : undefined,
    status: status ? String(status) : undefined,
    points: Number.isFinite(points) ? points : undefined,
  };
}

// Roster response: team -> roster -> players -> player[]
export function mapPlayersFromRosterResponse(resp: any): Player[] {
  try {
    const team = resp?.fantasy_content?.team;
    if (!team) return [];
    const teamObj = team.find((v: any) => v && typeof v === 'object' && 'roster' in v) || team[1];
    const rosterObj = teamObj?.roster || team?.roster;
    const playersArr = rosterObj?.players?.player || rosterObj?.players;
    const list: any[] = asArray(playersArr);
    const normalized: Player[] = [];
    for (const entry of list) {
      const core = entry?.player ?? entry?.[0]?.player ?? entry;
      const p = mapOnePlayer(core);
      if (p) normalized.push(p);
    }
    return normalized;
  } catch (e) {
    logger.warn('Failed to map roster response');
    return [];
  }
}

// League free agents response: league -> players -> player[]
export function mapFreeAgentsFromLeaguePlayersResponse(resp: any): Player[] {
  try {
    const league = resp?.fantasy_content?.league;
    const leagueObj = Array.isArray(league) ? league[1] : league;
    const players = leagueObj?.players?.player || leagueObj?.players;
    const list: any[] = asArray(players);
    const normalized: Player[] = [];
    for (const entry of list) {
      const core = entry?.player ?? entry?.[0]?.player ?? entry;
      const p = mapOnePlayer(core);
      if (p) normalized.push(p);
    }
    return normalized;
  } catch (e) {
    logger.warn('Failed to map free agents response');
    return [];
  }
}

// League teams: league -> teams -> team[] containing team_key
export function extractLeagueTeams(resp: any): Array<{ team_key: string; name?: string }> {
  try {
    const league = resp?.fantasy_content?.league;
    const leagueObj = Array.isArray(league) ? league[1] : league;
    const teams = leagueObj?.teams?.team || leagueObj?.teams;
    const list: any[] = asArray(teams);
    const out: Array<{ team_key: string; name?: string }> = [];
    for (const t of list) {
      const obj = Array.isArray(t) ? t.find((x) => x?.team_key) ?? t[0] : t;
      const team_key = obj?.team_key ?? t?.team_key;
      const name = obj?.name ?? obj?.nickname ?? obj?.team_name;
      if (team_key) out.push({ team_key: String(team_key), name: name ? String(name) : undefined });
    }
    return out;
  } catch (e) {
    logger.warn('Failed to extract league teams');
    return [];
  }
}

