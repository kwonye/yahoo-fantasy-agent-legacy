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

// Normalized league settings schema used by prompts/strategies
export type NormalizedLeagueSettings = {
  leagueName?: string;
  season?: number;
  positionCounts?: Record<string, number>;
  rosterPositions?: string[];
  flexSlots?: string[];
  benchSpots?: number;
  irSpots?: number;
  waiverType?: 'FAAB' | 'Priority';
  faabBudget?: number;
  tradeDeadlineDate?: string; // ISO date if available
  scoring?: Record<string, number>; // display_name -> modifier value
};

function coerceNumber(x: any): number | undefined {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

export function normalizeLeagueSettings(resp: any): NormalizedLeagueSettings {
  try {
    const league = resp?.fantasy_content?.league;
    const leagueObj = Array.isArray(league) ? league[1] : league;
    const settings = leagueObj?.settings || (Array.isArray(leagueObj) ? leagueObj.find((x: any) => x?.settings) : undefined);
    const out: NormalizedLeagueSettings = {};

    // Basic
    const name = leagueObj?.name || leagueObj?.league_name;
    const season = coerceNumber(leagueObj?.season) ?? coerceNumber(leagueObj?.season_year);
    if (name) out.leagueName = String(name);
    if (season) out.season = season;

    // Roster positions and counts
    const rosterPositions = settings?.roster_positions?.roster_position || settings?.roster_positions;
    const rpList: any[] = Array.isArray(rosterPositions) ? rosterPositions : rosterPositions ? [rosterPositions] : [];
    const positionCounts: Record<string, number> = {};
    const rosterOrder: string[] = [];
    const flexSlots: string[] = [];
    let benchSpots = 0;
    let irSpots = 0;
    for (const r of rpList) {
      const pos = String(r?.position ?? r?.pos ?? r);
      const count = coerceNumber(r?.count) ?? 1;
      if (!pos) continue;
      if (pos.includes('/')) {
        // Flex designation like W/R/T
        flexSlots.push(pos);
      } else if (pos === 'BN') {
        benchSpots += count ?? 1;
      } else if (pos === 'IR') {
        irSpots += count ?? 1;
      } else {
        positionCounts[pos] = (positionCounts[pos] || 0) + (count ?? 1);
        for (let i = 0; i < (count ?? 1); i++) rosterOrder.push(pos);
      }
    }
    if (Object.keys(positionCounts).length) out.positionCounts = positionCounts;
    if (rosterOrder.length) out.rosterPositions = rosterOrder;
    if (flexSlots.length) out.flexSlots = flexSlots;
    if (benchSpots) out.benchSpots = benchSpots;
    if (irSpots) out.irSpots = irSpots;

    // Waivers/FAAB
    const waiverTypeRaw = settings?.waiver_type || settings?.waiver_rule || settings?.waivers_type;
    if (waiverTypeRaw) {
      const v = String(waiverTypeRaw).toUpperCase();
      out.waiverType = v.includes('FAAB') ? 'FAAB' : 'Priority';
    }
    const faabBudget = settings?.faab || settings?.faab_budget || settings?.faab_balance;
    const budgetNum = coerceNumber(faabBudget);
    if (budgetNum !== undefined) out.faabBudget = budgetNum;

    // Trade deadline
    const tradeEnd = settings?.trade_end_date || settings?.trade_deadline || leagueObj?.trade_end_date;
    if (tradeEnd) out.tradeDeadlineDate = String(tradeEnd);

    // Scoring: map stat_modifiers by display name
    const cats = settings?.stat_categories?.stats || settings?.stat_categories;
    const catList: any[] = cats?.stat || cats ? (Array.isArray(cats?.stat || cats) ? (cats.stat || cats) : [cats.stat || cats]) : [];
    const modifiers = settings?.stat_modifiers?.stats || settings?.stat_modifiers;
    const modList: any[] = modifiers?.stat || modifiers ? (Array.isArray(modifiers?.stat || modifiers) ? (modifiers.stat || modifiers) : [modifiers.stat || modifiers]) : [];
    const idToName = new Map<string, string>();
    for (const c of catList) {
      const id = String(c?.stat_id ?? c?.id ?? '');
      const nm = c?.display_name || c?.name || c?.abbrev;
      if (id) idToName.set(id, String(nm ?? id));
    }
    const scoring: Record<string, number> = {};
    for (const m of modList) {
      const id = String(m?.stat?.stat_id ?? m?.stat_id ?? '');
      const val = coerceNumber(m?.value ?? m?.stat?.value);
      const key = idToName.get(id) || id;
      if (val !== undefined) scoring[key] = val;
    }
    if (Object.keys(scoring).length) out.scoring = scoring;

    return out;
  } catch {
    return {} as NormalizedLeagueSettings;
  }
}
