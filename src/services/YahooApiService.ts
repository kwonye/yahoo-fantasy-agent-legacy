import axios, { AxiosInstance } from 'axios';
import { YahooOAuthClient } from './YahooOAuthClient';
import { League, LeagueSettings, Lineup, Player, Position } from '../models';
import { TradeProposal, WaiverClaim } from '../models/Decision';

export class YahooApiService {
  private readonly http: AxiosInstance;
  private readonly baseUrl: string;
  private readonly oauth: YahooOAuthClient;

  constructor(oauth: YahooOAuthClient, baseUrl = 'https://fantasysports.yahooapis.com/fantasy/v2') {
    this.oauth = oauth;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.http = axios.create();
  }

  private async authHeaders() {
    const token = await this.oauth.getValidAccessToken();
    return { Authorization: `Bearer ${token}` };
  }

  private static async sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  private async getJson(url: string): Promise<any> {
    const headers = {
      ...(await this.authHeaders()),
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) YahooFantasyBot/1.0 Safari/537.36',
      'Cache-Control': 'no-cache',
    } as Record<string, string>;
    const maxAttempts = 4;
    let lastErr: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { data } = await this.http.get(url, { headers });
        return data;
      } catch (err: any) {
        lastErr = err;
        const status = err?.response?.status;
        if (status === 999 || status === 429 || (typeof status === 'number' && status >= 500 && status < 600)) {
          const base = 400 * Math.pow(2, attempt - 1);
          const jitter = Math.floor(Math.random() * 200);
          await YahooApiService.sleep(base + jitter);
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  // ---------------- XML write helpers (best-effort scaffolding) ----------------
  private async postXml(pathname: string, xml: string): Promise<any> {
    const headers = { ...(await this.authHeaders()), 'Content-Type': 'application/xml' };
    const url = `${this.baseUrl}${pathname}`;
    try {
      const { data } = await this.http.post(url, xml, { headers });
      return data;
    } catch (e: any) {
      // Log error payload for diagnostics
      try {
        this.debugDump('last_write_error.json', {
          url,
          status: e?.response?.status,
          statusText: e?.response?.statusText,
          data: e?.response?.data || null,
          message: e?.message,
          xml,
        });
      } catch {}
      throw e;
    }
  }

  async updateRosterXml(teamKey: string, xml: string): Promise<{ success: boolean }> {
    // Yahoo typically accepts roster updates via team roster endpoint
    const path = `/team/${encodeURIComponent(teamKey)}/roster`;
    await this.postXml(path, xml);
    return { success: true };
  }

  async submitTransactionsXml(leagueKey: string, xml: string): Promise<{ success: boolean; id?: string }> {
    const path = `/league/${encodeURIComponent(leagueKey)}/transactions`;
    const data = await this.postXml(path, xml);
    return { success: true, id: data?.transaction?.id };
  }

  async proposeTradeXml(leagueKey: string, xml: string): Promise<{ success: boolean; id?: string }> {
    const path = `/league/${encodeURIComponent(leagueKey)}/transactions`;
    const data = await this.postXml(path, xml);
    return { success: true, id: data?.transaction?.id };
  }

  async getLeague(leagueKey: string): Promise<League> {
    const url = `${this.baseUrl}/league/${encodeURIComponent(leagueKey)}?format=json`;
    const data = await this.getJson(url);
    this.debugDump('last_league_raw.json', data);
    return this.mapLeague(data, leagueKey);
  }

  // Fetch all teams for a league with keys and (optional) names
  async getLeagueTeams(leagueKey: string): Promise<Array<{ key: string; name?: string }>> {
    const url = `${this.baseUrl}/league/${encodeURIComponent(leagueKey)}/teams?format=json`;
    const data = await this.getJson(url);
    this.debugDump('last_league_teams_raw.json', data);
    // Attempt to parse Yahoo fantasy_content structure
    const out: Array<{ key: string; name?: string }> = [];
    try {
      const fc = (data as any)?.fantasy_content;
      const leagueArr = fc?.league;
      if (leagueArr) {
        const teamsNode = (leagueArr.find((x: any) => x?.teams) || {}).teams;
        if (teamsNode) {
          // Yahoo API returns teams as an object with numeric keys (0, 1, ...) and a 'count' property
          for (let i = 0; i < teamsNode.count; i++) {
            const entry = teamsNode[String(i)];
            const node = entry?.team?.[0]?.[0];
            if (!node) continue;
            // node is often an array of objects with fields like team_key, name, etc.
            const flat = Array.isArray(node)
              ? node.reduce((acc: any, part: any) => ({ ...acc, ...part }), {})
              : node;
            const key = flat.team_key || flat.teamKey || flat.key;
            const name = flat.name || flat.team_name || undefined;
            if (key) out.push({ key: String(key), name: name ? String(name) : undefined });
          }
        }
      }
    } catch {}
    // Fallback for simplified test shapes
    if (out.length === 0 && Array.isArray((data as any)?.teams)) {
      for (const t of (data as any).teams) {
        if (t?.key) out.push({ key: String(t.key), name: t.name });
      }
    }
    this.debugDump('last_league_teams_parsed.json', out);
    return out;
  }

  async getTeamRoster(teamKey: string, week?: number): Promise<Player[]> {
    // If week is not provided, derive leagueKey from teamKey and try to load currentWeek
    let targetWeek = week;
    if (targetWeek === undefined) {
      const leagueKey = this.deriveLeagueKeyFromTeamKey(teamKey);
      if (leagueKey) {
        try {
          const league = await this.getLeague(leagueKey);
          if (typeof league.currentWeek === 'number') targetWeek = league.currentWeek;
        } catch {
          // ignore; will fall back to no-week call
        }
      }
    }

    const weekSeg = typeof targetWeek === 'number' ? `;week=${targetWeek}` : '';
    const url = `${this.baseUrl}/team/${encodeURIComponent(teamKey)}/roster${weekSeg}?format=json`;
    const data = await this.getJson(url);
    this.debugDump('last_roster_raw.json', data);
    return this.mapRoster(data);
  }

  private deriveLeagueKeyFromTeamKey(teamKey: string): string | null {
    const idx = teamKey.lastIndexOf('.t.');
    if (idx > 0) return teamKey.slice(0, idx);
    return null;
  }

  private debugDump(filename: string, data: any) {
    // Debug controlled by dashboard setting
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ConfigManager } = require('./ConfigManager');
      const cm = new ConfigManager();
      const app = cm.loadAppSettings();
      if (!app?.debugYahooEnabled) return;
    } catch {
      return;
    }
    try {
      // Lazy import to avoid top-level fs in browser builds
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require('path');
      const dir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // ignore dump errors
    }
  }

  // ---------------- Team info (FAAB, priority, name) ----------------
  async getTeamInfo(teamKey: string): Promise<{ id: string; name?: string; faabBalance?: number; waiverPriority?: number }>{
    const url = `${this.baseUrl}/team/${encodeURIComponent(teamKey)}?format=json`;
    const data = await this.getJson(url);
    this.debugDump('last_team_raw.json', data);
    const fc = data?.fantasy_content;
    const teamArr = fc?.team;
    const info: any = { id: String(teamKey) };
    const visit = (n: any) => {
      if (!n) return;
      if (Array.isArray(n)) { for (const v of n) visit(v); return; }
      if (typeof n !== 'object') return;
      // Common fields
      if (typeof (n as any).name === 'string') info.name = (n as any).name;
      const fb = (n as any).faab_balance ?? (n as any).faab ?? (n as any).faabBudget ?? (n as any).faab_remaining;
      if (fb !== undefined) {
        const num = Number(fb);
        if (Number.isFinite(num)) info.faabBalance = num;
      }
      const wp = (n as any).waiver_priority ?? (n as any).waiverPriority;
      if (wp !== undefined) {
        const num = Number(wp);
        if (Number.isFinite(num)) info.waiverPriority = num;
      }
      for (const v of Object.values(n)) visit(v);
    };
    try { visit(teamArr || fc?.team || fc); } catch {}
    return info as { id: string; name?: string; faabBalance?: number; waiverPriority?: number };
  }

  async setLineup(_teamKey: string, _lineup: Lineup): Promise<void> {
    // Compatibility helper for tests/dev tools: POST JSON to a pseudo endpoint.
    // Real Yahoo writes require XML; use updateRosterXml() in production.
    const url = `${this.baseUrl}/team/${encodeURIComponent(_teamKey)}/lineup`;
    const headers = { ...(await this.authHeaders()), 'Content-Type': 'application/json' } as any;
    await this.http.post(url, { lineup: _lineup }, { headers });
  }

  async getWaiverWirePlayers(leagueKey: string, count: number = 25): Promise<Player[]> {
    // Per Yahoo Fantasy Sports API: /league/{league_key}/players;status=W and /players;status=FA
    // Try waivers first, then free agents as fallback.
    const base = `${this.baseUrl}/league/${encodeURIComponent(leagueKey)}`;
    const urls = [
      // Common in tests/mocks
      `${base}/players?status=waivers&format=json`,
      // Yahoo-style selectors
      `${base}/players;status=W;count=${count}?format=json`,
      `${base}/players;status=FA;count=${count}?format=json`,
    ];
    for (const url of urls) {
      try {
        const data = await this.getJson(url);
        this.debugDump('last_waivers_raw.json', { url, data });
        const parsed = this.extractLeaguePlayers(data);
        this.debugDump('last_waivers_parsed.json', parsed);
        if (parsed.length > 0) return parsed;
      } catch {
        // continue
      }
    }
    return [];
  }

  // Return only immediate free agents (not players on waivers)
  async getFreeAgents(leagueKey: string, count: number = 25): Promise<Player[]> {
    const base = `${this.baseUrl}/league/${encodeURIComponent(leagueKey)}`;
    const urls = [
      `${base}/players;status=FA;count=${count}?format=json`,
      `${base}/players?status=free_agents&format=json`,
    ];
    for (const url of urls) {
      try {
        const data = await this.getJson(url);
        this.debugDump('last_free_agents_raw.json', { url, data });
        const parsed = this.extractLeaguePlayers(data);
        this.debugDump('last_free_agents_parsed.json', parsed);
        if (parsed.length > 0) return parsed;
      } catch {
        // continue
      }
    }
    return [];
  }

  // ---------------- Trades (reads) ----------------
  async getAllTransactionsNormalized(leagueKey: string, teamKey?: string, count: number = 200, dbg?: { tried: string[] }): Promise<any[]> {
    // Resolve canonical keys
    let canonicalLeagueKey = leagueKey;
    try {
      const league = await this.getLeague(leagueKey);
      if (league?.id && /\.l\./.test(league.id)) canonicalLeagueKey = league.id;
    } catch {}
    let canonicalTeamKey = teamKey;
    try {
      if (teamKey && canonicalLeagueKey && canonicalLeagueKey !== leagueKey) {
        const gamePrefix = canonicalLeagueKey.split('.l.')[0];
        canonicalTeamKey = teamKey.replace(/^[^.]+\.l\./, gamePrefix + '.l.');
      }
    } catch {}
    const tk = canonicalTeamKey ? encodeURIComponent(canonicalTeamKey) : '';
    const lk = encodeURIComponent(canonicalLeagueKey);

    const typeVariants = ['trade', 'pending_trade'];
    const teamUrls: string[] = [];
    const leagueUrls: string[] = [];
    if (canonicalTeamKey) {
      teamUrls.push(`${this.baseUrl}/team/${tk}/transactions;count=${count}?format=json`);
      teamUrls.push(`${this.baseUrl}/team/${tk}/transactions;start=0;count=${count}?format=json`);
      for (const tv of typeVariants) {
        teamUrls.push(`${this.baseUrl}/team/${tk}/transactions;types=${tv};count=${count}?format=json`);
        teamUrls.push(`${this.baseUrl}/team/${tk}/transactions;types=${tv};start=0;count=${count}?format=json`);
      }
      teamUrls.push(`${this.baseUrl}/team/${tk}/trades?format=json`);
    }
    leagueUrls.push(`${this.baseUrl}/league/${lk}/transactions;count=${count}?format=json`);
    leagueUrls.push(`${this.baseUrl}/league/${lk}/transactions;start=0;count=${count}?format=json`);
    for (const tv of typeVariants) {
      leagueUrls.push(`${this.baseUrl}/league/${lk}/transactions;types=${tv};count=${count}?format=json`);
      leagueUrls.push(`${this.baseUrl}/league/${lk}/transactions;types=${tv};start=0;count=${count}?format=json`);
    }
    leagueUrls.push(`${this.baseUrl}/league/${lk}/trades?format=json`);

    const urls = [...teamUrls, ...leagueUrls];
    const results: any[] = [];
    for (const url of urls) {
      if (dbg && Array.isArray(dbg.tried)) dbg.tried.push(url);
      try {
        const data = await this.getJson(url);
        this.debugDump('last_trades_raw.json', data);
        results.push(...this.extractAllTransactions(data));
      } catch {
        // ignore and continue
      }
    }
    // de-duplicate by id if present, else by JSON of moves+teams
    const seen = new Set<string>();
    const unique: any[] = [];
    for (const tx of results) {
      const id = String(tx?.id || '');
      const key = id || JSON.stringify({ moves: tx?.moves || [], teamKeys: tx?.teamKeys || [], status: tx?.status || '' });
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(tx);
    }
    return unique;
  }
  async getTransactionByKey(transactionKey: string): Promise<any | null> {
    const url = `${this.baseUrl}/transaction/${encodeURIComponent(transactionKey)}?format=json`;
    const data = await this.getJson(url);
    this.debugDump('last_transaction_raw.json', data);
    const fc = data?.fantasy_content;
    const tx = fc?.transaction || (Array.isArray(fc?.transaction) ? fc.transaction : null);
    if (!tx) return null;
    return this.normalizeTransaction(tx);
  }

  async getTransactionById(leagueKey: string, trid: string | number): Promise<any | null> {
    // Resolve canonical league key with game id prefix (e.g., 461.l.399238)
    let canonicalLeagueKey = leagueKey;
    try {
      const league = await this.getLeague(leagueKey);
      if (league?.id && /\.l\./.test(league.id)) canonicalLeagueKey = league.id;
    } catch {}
    const transactionKey = `${canonicalLeagueKey}.tr.${trid}`;
    return this.getTransactionByKey(transactionKey);
  }
  async getPendingTrades(leagueKey: string, teamKey?: string, dbg?: { tried: string[] }): Promise<any[]> {
    // Resolve canonical (numeric) league key if possible
    let canonicalLeagueKey = leagueKey;
    try {
      const league = await this.getLeague(leagueKey);
      // Our mapLeague returns id as the league key in Yahoo's format (e.g., 461.l.399238)
      if (league?.id && /\.l\./.test(league.id)) canonicalLeagueKey = league.id;
    } catch {}
    // Rewrite teamKey prefix to match canonical game id if necessary
    let canonicalTeamKey = teamKey;
    try {
      if (teamKey && canonicalLeagueKey && canonicalLeagueKey !== leagueKey) {
        const gamePrefix = canonicalLeagueKey.split('.l.')[0];
        canonicalTeamKey = teamKey.replace(/^[^.]+\.l\./, gamePrefix + '.l.');
      }
    } catch {}
    const tk = canonicalTeamKey ? encodeURIComponent(canonicalTeamKey) : '';
    const lk = encodeURIComponent(canonicalLeagueKey);
    const typeVariants = ['trade', 'pending_trade'];
    const teamCandidates = canonicalTeamKey ? [
      // Specific type queries first (both trade and pending_trade)
      ...typeVariants.flatMap((tv) => [
        `${this.baseUrl}/team/${tk}/transactions;types=${tv};count=50?format=json`,
        `${this.baseUrl}/team/${tk}/transactions;types=${tv};start=0;count=200?format=json`,
        `${this.baseUrl}/team/${tk}/transactions;type=${tv};count=50?format=json`,
        `${this.baseUrl}/team/${tk}/transactions;type=${tv};start=0;count=200?format=json`,
      ]),
      // Generic transactions lists as fallback
      `${this.baseUrl}/team/${tk}/transactions;count=50?format=json`,
      `${this.baseUrl}/team/${tk}/transactions;start=0;count=200?format=json`,
      // Team trades collection
      `${this.baseUrl}/team/${tk}/trades?format=json`,
    ] : [];
    const leagueCandidates = [
      ...typeVariants.flatMap((tv) => [
        `${this.baseUrl}/league/${lk}/transactions;types=${tv};count=50?format=json`,
        `${this.baseUrl}/league/${lk}/transactions;types=${tv};start=0;count=200?format=json`,
        `${this.baseUrl}/league/${lk}/transactions;type=${tv};count=50?format=json`,
        `${this.baseUrl}/league/${lk}/transactions;type=${tv};start=0;count=200?format=json`,
      ]),
      `${this.baseUrl}/league/${lk}/transactions;count=50?format=json`,
      `${this.baseUrl}/league/${lk}/transactions;start=0;count=200?format=json`,
      `${this.baseUrl}/league/${lk}/trades?format=json`,
    ];
    const all = [...teamCandidates, ...leagueCandidates];
    for (const url of all) {
      if (dbg && Array.isArray(dbg.tried)) dbg.tried.push(url);
      try {
        const data = await this.getJson(url);
        this.debugDump('last_trades_raw.json', data);
        const trades = this.extractTrades(data);
        if (trades.length) return trades;
      } catch {
        // try next
      }
    }
    // Final fallback: scan a broader set and pull any trade-related transactions
    try {
      const broad = await this.getAllTransactionsNormalized(leagueKey, teamKey, 200, dbg);
      return broad.filter((t) => t && String(t.type || '').toLowerCase().includes('trade'));
    } catch {
      return [];
    }
  }

  private extractTrades(data: any): any[] {
    const out: any[] = [];
    const fc = data?.fantasy_content;
    if (!fc) return out;
    const pushTx = (tx: any) => { if (tx) out.push(this.normalizeTransaction(tx)); };
    // 1) league.transactions
    const leagueArr = fc.league;
    const leagueTx = leagueArr?.find((x: any) => x?.transactions)?.transactions;
    if (leagueTx) this.collectTransactionsFromContainer(leagueTx, pushTx);
    // 2) team.transactions
    const teamArr = fc.team;
    const teamTx = teamArr?.find((x: any) => x?.transactions)?.transactions;
    if (teamTx) this.collectTransactionsFromContainer(teamTx, pushTx);
    // 3) root transactions (rare)
    if (fc.transactions) this.collectTransactionsFromContainer(fc.transactions, pushTx);
    // 4) deep scan fallback: find any objects with a `transaction` key
    this.deepScanForTransactions(fc, pushTx);
    // Return all trade-related transactions (include pending_trade as well)
    return out.filter((t) => {
      if (!t || !t.type) return false;
      try {
        return String(t.type).toLowerCase().includes('trade');
      } catch {
        return t.type === 'trade';
      }
    });
  }

  private extractAllTransactions(data: any): any[] {
    const out: any[] = [];
    const fc = data?.fantasy_content;
    if (!fc) return out;
    const pushTx = (tx: any) => { if (tx) out.push(this.normalizeTransaction(tx)); };
    const leagueArr = fc.league;
    const leagueTx = leagueArr?.find((x: any) => x?.transactions)?.transactions;
    if (leagueTx) this.collectTransactionsFromContainer(leagueTx, pushTx);
    const teamArr = fc.team;
    const teamTx = teamArr?.find((x: any) => x?.transactions)?.transactions;
    if (teamTx) this.collectTransactionsFromContainer(teamTx, pushTx);
    if (fc.transactions) this.collectTransactionsFromContainer(fc.transactions, pushTx);
    this.deepScanForTransactions(fc, pushTx);
    return out;
  }

  private collectTransactionsFromContainer(container: any, pushTx: (tx: any) => void) {
    if (!container) return;
    if (Array.isArray(container)) {
      for (let i = 0; i < container.length; i++) {
        const node = container[i];
        const tx = node?.transaction || node;
        if (tx) pushTx(tx);
      }
      return;
    }
    if (typeof container === 'object') {
      const vals = Object.values(container) as any[];
      for (const v of vals) {
        const tx = (v && (v as any).transaction) ? (v as any).transaction : v;
        if (tx) pushTx(tx);
      }
    }
  }
  private deepScanForTransactions(node: any, pushTx: (tx: any) => void, depth = 0, seen = new Set<any>()) {
    if (!node || depth > 4) return;
    if (seen.has(node)) return; seen.add(node);
    if (Array.isArray(node)) { for (const v of node) this.deepScanForTransactions(v, pushTx, depth + 1, seen); return; }
    if (typeof node === 'object') {
      if ((node as any).transaction) pushTx((node as any).transaction);
      for (const v of Object.values(node)) this.deepScanForTransactions(v, pushTx, depth + 1, seen);
    }
  }
  private normalizeTransaction(node: any): any {
    // Simplify Yahoo transaction node
    const acc: any = {};
    const mergeObj = (obj: any) => { if (!obj) return; Object.assign(acc, obj); };
    const walk = (n: any) => {
      if (!n) return;
      if (Array.isArray(n)) n.forEach(walk);
      else if (typeof n === 'object') mergeObj(n);
    };
    walk(node);
    // Build simplified trade representation when possible
    let id = acc.transaction_key ?? acc.transaction_id ?? acc.id ?? acc.trade_id;
    const status = acc.status ?? acc.trade_status ?? acc.state ?? 'pending';
    const moves = this.collectTradeMoves(node);
    const { teamKeys, teamIds } = this.collectTeams(node);
    let type = String(acc.type || acc.transaction_type || '').toLowerCase();
    if (!id) {
      // Deep-scan for a transaction key string, e.g., nfl.l.XXXXXX.tr.N or 461.l.XXXX.tr.N
      const reTrKey = /[a-z0-9]+\.l\.\d+\.tr\.\d+/i;
      const seenK = new Set<any>();
      const findKey = (n: any): string | null => {
        if (!n) return null;
        if (typeof n === 'string') return reTrKey.test(n) ? n : null;
        if (typeof n !== 'object') return null;
        if (seenK.has(n)) return null; seenK.add(n);
        if (Array.isArray(n)) { for (const v of n) { const f = findKey(v); if (f) return f; } return null; }
        for (const v of Object.values(n)) { const f = findKey(v); if (f) return f; }
        return null;
      };
      const found = findKey(node);
      if (found) id = found;
    }
    if (!type) {
      // Infer type from presence of trade parties/fields
      const hasTradeHints = (() => {
        try {
          const s = JSON.stringify(node).toLowerCase();
          return s.includes('tradee') || s.includes('trader') || s.includes('trade_proposed') || s.includes('type":"trade');
        } catch { return false; }
      })();
      type = hasTradeHints ? 'trade' : (String(acc.type || '').toLowerCase() || '');
    }
    const normalizedType = type;
    return {
      id: String(id || ''),
      type: normalizedType,
      status,
      moves,
      teamKeys,
      teamIds,
      raw: node,
    };
  }

  private collectTradeMoves(node: any): Array<{ playerId?: string; name?: string; position?: string; source?: string; destination?: string; type?: string }>{
    const out: Array<{ playerId?: string; name?: string; position?: string; source?: string; destination?: string; type?: string }> = [];
    const visit = (n: any) => {
      if (!n) return;
      if (Array.isArray(n)) { n.forEach(visit); return; }
      if (typeof n === 'object') {
        // Player node pattern with transaction_data
        const playerNode = (n as any).player || n;
        const pobj = playerNode ? this.normalizeYahooPlayer(playerNode) : {};
        const playerId = pobj.player_id ?? pobj.playerId ?? pobj.id ?? pobj.player_key;
        const name = pobj.name?.full ?? pobj.name ?? pobj.fullName;
        const pos = pobj.display_position ?? pobj.primary_position ?? pobj.position;
        const td = (n as any).transaction_data || (pobj as any).transaction_data;
        const tdArr = Array.isArray(td) ? td : (td ? [td] : []);
        for (const t of tdArr) {
          const type = String(t?.type || '').toLowerCase();
          const source = t?.source_team_key || t?.source_team || t?.source_team_id || t?.source_team_key_id;
          const destination = t?.destination_team_key || t?.destination_team || t?.destination_team_id || t?.dest_team_key;
          if (playerId || type || source || destination) out.push({ playerId: playerId ? String(playerId) : undefined, name, position: pos, source: source ? String(source) : undefined, destination: destination ? String(destination) : undefined, type });
        }
        // Also capture top-level trade parties if present (trader/tradee)
        const trader = (n as any).trader_team_key || (n as any).trader_team_id;
        const tradee = (n as any).tradee_team_key || (n as any).tradee_team_id;
        if ((trader || tradee) && !tdArr.length) {
          out.push({ playerId: undefined, name: undefined, position: undefined, source: trader ? String(trader) : undefined, destination: tradee ? String(tradee) : undefined, type: 'trade' });
        }
        Object.values(n).forEach(visit);
      }
    };
    try { visit(node); } catch {}
    return out;
  }

  private collectTeams(node: any): { teamKeys: string[]; teamIds: string[] } {
    const teamKeyRegex = /[a-z]+\.l\.\d+\.t\.\d+/i;
    const teamIdRegex = /\bteam_id\b/i;
    const keys = new Set<string>();
    const ids = new Set<string>();
    const seen = new Set<any>();
    const visit = (n: any) => {
      if (!n) return;
      if (typeof n === 'string') {
        const m = n.match(teamKeyRegex);
        if (m) keys.add(m[0]);
        return;
      }
      if (typeof n !== 'object') return;
      if (seen.has(n)) return; seen.add(n);
      if (Array.isArray(n)) { n.forEach(visit); return; }
      for (const [k, v] of Object.entries(n)) {
        if (typeof v === 'string' && k.toLowerCase().includes('team_key')) {
          if (teamKeyRegex.test(v)) keys.add(v);
        }
        if ((k.toLowerCase().includes('team_id') || teamIdRegex.test(k)) && (typeof v === 'string' || typeof v === 'number')) {
          ids.add(String(v));
        }
        visit(v);
      }
    };
    try { visit(node); } catch {}
    return { teamKeys: Array.from(keys), teamIds: Array.from(ids) };
  }

  private extractLeaguePlayers(data: any): Player[] {
    // Support simplified test shape
    if (Array.isArray(data?.players)) {
      return data.players.map((p: any) => this.mapPlayer(p));
    }
    const players: Player[] = [];
    const fc = data?.fantasy_content;
    if (!fc?.league) return players;
    const leagueArr = fc.league;
    const playersContainer = leagueArr?.[1]?.players;
    if (!playersContainer) return players;
    const pushFromPlayerNode = (playerNode: any) => {
      const pobj = this.normalizeYahooPlayer(playerNode);
      const id = pobj.player_id ?? pobj.playerId ?? pobj.id ?? pobj.player_key;
      const name = pobj.name?.full ?? pobj.name ?? pobj.fullName;
      const pos = pobj.display_position ?? pobj.primary_position ?? pobj.position;
      const tm = pobj.editorial_team_abbr ?? pobj.team;
      const status = pobj.status ?? 'ACTIVE';
      players.push(this.mapPlayer({ id, name, position: pos, team: tm, status }));
    };
    if (Array.isArray(playersContainer)) {
      for (let i = 1; i < playersContainer.length; i++) {
        const entry = playersContainer[i];
        const node = entry?.player;
        if (node) pushFromPlayerNode(node);
      }
    } else if (typeof playersContainer === 'object') {
      const values = Object.values(playersContainer) as any[];
      for (const v of values) {
        const node = (v && (v as any).player) ? (v as any).player : undefined;
        if (node) pushFromPlayerNode(node);
      }
    }
    return players;
  }

  async submitWaiverClaims(_leagueKey: string, _claims: WaiverClaim[]): Promise<{ success: boolean }>{
    // Compatibility helper for tests/dev tools. Real API uses XML via submitTransactionsXml().
    const url = `${this.baseUrl}/league/${encodeURIComponent(_leagueKey)}/waivers`;
    const headers = { ...(await this.authHeaders()), 'Content-Type': 'application/json' } as any;
    const { data } = await this.http.post(url, { claims: _claims }, { headers });
    return { success: !!(data && (data.success === true || data.ok === true)) };
  }

  async proposeTrade(_leagueKey: string, _proposal: TradeProposal): Promise<{ success: boolean; id?: string }>{
    // Compatibility helper for tests/dev tools. Real API uses XML via proposeTradeXml().
    const url = `${this.baseUrl}/league/${encodeURIComponent(_leagueKey)}/trades`;
    const headers = { ...(await this.authHeaders()), 'Content-Type': 'application/json' } as any;
    const { data } = await this.http.post(url, _proposal, { headers });
    return { success: !!(data && (data.success === true || data.ok === true)), id: data?.id };
  }

  private mapPlayer(p: any): Player {
    // Normalize basic fields used by our models
    const pos = String(p.position ?? p.pos ?? 'BENCH').toUpperCase();
    return {
      id: String(p.id ?? p.playerId ?? ''),
      name: p.name ?? p.fullName ?? 'Unknown',
      position: (Position as any)[pos] ?? Position.BENCH,
      team: p.team ?? p.proTeam ?? 'FA',
      status: p.status ?? 'ACTIVE',
      matchup: p.matchup,
    } as Player;
  }

  // ---------------- Yahoo mapping helpers ----------------
  private mapLeague(data: any, fallbackKey: string): League {
    // Support both simplified test shape and Yahoo fantasy_content shape
    if (data?.league) {
      const payload = data.league;
      return {
        id: payload.id ?? String(payload.leagueId ?? fallbackKey),
        name: payload.name ?? 'League',
        teams: payload.teams ?? [],
        settings: payload.settings ?? {
          rosterPositions: payload.rosterPositions ?? {},
          waiverType: payload.waiverType ?? 'FAAB',
          tradeDeadline: payload.tradeDeadline ? new Date(payload.tradeDeadline) : new Date(),
          playoffWeeks: payload.playoffWeeks ?? [],
          scoringType: payload.scoringType ?? 'head-to-head',
        },
        currentWeek: payload.currentWeek ?? 1,
        season: payload.season ?? new Date().getFullYear(),
      };
    }
    const fc = data?.fantasy_content;
    if (fc?.league) {
      // Yahoo structures objects as arrays alternating keys and objects
      const leagueArr = fc.league;
      const meta = leagueArr?.[0] || {};
      const details = (leagueArr?.[1] ?? {}) as any;
      const name = meta.name ?? details.name;
      const key = meta.league_key ?? details.league_key ?? fallbackKey;
      const season = parseInt(meta.season ?? details.season, 10) || new Date().getFullYear();
      const currentWeek = parseInt(meta.current_week ?? details.current_week, 10) || 1;
      // Basic settings mapping
      const settingsObj = (leagueArr?.find((x: any) => x?.settings) || {}).settings?.[0] ?? {};
      const scoringType = settingsObj.scoring_type ?? 'head-to-head';
      const rosterPositionsArr = settingsObj.roster_positions?.[0]?.roster_position ?? [];
      const rosterPositions = rosterPositionsArr.reduce((acc: any, rp: any) => {
        const p = rp?.position ?? rp?.roster_position ?? rp;
        const count = parseInt(rp?.count ?? 0, 10) || 0;
        if (p) acc[String(p).toUpperCase()] = count;
        return acc;
      }, {} as Record<string, number>);
      const settings: LeagueSettings = {
        rosterPositions,
        waiverType: settingsObj.waiver_type ?? 'FAAB',
        tradeDeadline: new Date(),
        playoffWeeks: [],
        scoringType,
      };
      return {
        id: String(key),
        name: String(name ?? 'League'),
        teams: [],
        settings,
        currentWeek,
        season,
      };
    }
    // Fallback generic
    return {
      id: String(fallbackKey),
      name: 'League',
      teams: [],
      settings: { rosterPositions: {}, waiverType: 'FAAB', tradeDeadline: new Date(), playoffWeeks: [], scoringType: 'head-to-head' },
      currentWeek: 1,
      season: new Date().getFullYear(),
    };
  }

  private mapRoster(data: any): Player[] {
    // Support simplified test shape
    if (Array.isArray(data?.players)) {
      return data.players.map((p: any) => this.mapPlayer(p));
    }
    const rosterPlayers = data?.roster?.players;
    if (Array.isArray(rosterPlayers)) {
      return rosterPlayers.map((p: any) => this.mapPlayer(p));
    }
    const fc = data?.fantasy_content;
    if (fc?.team) {
      const teamArr = fc.team;
      const roster = (teamArr?.find((x: any) => x?.roster) || {}).roster;
      const playersContainer = roster?.[1]?.players;
      const players: Player[] = [];
      if (Array.isArray(playersContainer)) {
        // playersContainer[0] is {count}, subsequent indices have {player}
        for (let i = 1; i < playersContainer.length; i++) {
          const entry = playersContainer[i];
          const playerNode = entry?.player;
          if (!playerNode) continue;
          const pobj = Array.isArray(playerNode)
            ? playerNode.reduce((acc: any, part: any) => ({ ...acc, ...part }), {})
            : playerNode;
          const id = pobj.player_id ?? pobj.playerId ?? pobj.id ?? pobj.player_key;
          const name = pobj.name?.full ?? pobj.name ?? pobj.fullName;
          const pos = pobj.display_position ?? pobj.position;
          const tm = pobj.editorial_team_abbr ?? pobj.team;
          const status = pobj.status ?? 'ACTIVE';
          players.push(
            this.mapPlayer({
              id,
              name,
              position: pos,
              team: tm,
              status,
            })
          );
        }
        return players;
      }
    }
    return [];
  }

  // Returns roster entries with selected lineup slot if available
  async getTeamRosterWithSlots(teamKey: string, week?: number): Promise<Array<{ slot?: string; player: Player }>> {
    // Derive week if not provided
    let targetWeek = week;
    if (targetWeek === undefined) {
      const leagueKey = this.deriveLeagueKeyFromTeamKey(teamKey);
      if (leagueKey) {
        try {
          const league = await this.getLeague(leagueKey);
          if (typeof league.currentWeek === 'number') targetWeek = league.currentWeek;
        } catch {}
      }
    }
    const weekSeg = typeof targetWeek === 'number' ? `;week=${targetWeek}` : '';
    const url = `${this.baseUrl}/team/${encodeURIComponent(teamKey)}/roster${weekSeg}?format=json`;
    const data = await this.getJson(url);
    this.debugDump('last_roster_with_slots_raw.json', data);
    const entries: Array<{ slot?: string; player: Player }> = [];
    // Path 1: fantasy_content structure
    const fc = data?.fantasy_content;
    if (fc?.team) {
      const teamArr = fc.team;
      // Try multiple shapes to extract players
      const playerNodes = this.findPlayerNodes(teamArr);
      for (const node of playerNodes) {
        const pobj = this.normalizeYahooPlayer(node);
        const slot = this.extractSelectedSlot(pobj?.selected_position);
        const id = pobj.player_id ?? pobj.playerId ?? pobj.id ?? pobj.player_key;
        const name = pobj.name?.full ?? pobj.name ?? pobj.fullName;
        const pos = pobj.display_position ?? pobj.position;
        const tm = pobj.editorial_team_abbr ?? pobj.team;
        const status = pobj.status ?? 'ACTIVE';
        const player = this.mapPlayer({ id, name, position: pos, team: tm, status });
        entries.push({ slot, player });
      }
      if (entries.length > 0) return entries;
    }
    // Path 2: simplified shape
    const simple = this.mapRoster(data);
    return simple.map((p) => ({ player: p }));
  }

  private extractSelectedSlot(sp: any): string | undefined {
    if (!sp) return undefined;
    if (typeof sp === 'string') return sp;
    if (Array.isArray(sp)) {
      for (const v of sp) {
        const r = this.extractSelectedSlot(v);
        if (r) return r;
      }
      return undefined;
    }
    if (typeof sp === 'object') {
      if (sp.position) return String(sp.position);
      if (sp.selected_position) return this.extractSelectedSlot(sp.selected_position);
    }
    return undefined;
  }

  private findPlayerNodes(teamArr: any): any[] {
    // Walk through team array to find roster -> players -> { player }
    const results: any[] = [];
    const collectFromPlayers = (players: any) => {
      if (!players) return;
      if (Array.isArray(players)) {
        for (const item of players) {
          if (item?.player) results.push(item.player);
          else if (Array.isArray(item)) {
            for (const sub of item) if (sub?.player) results.push(sub.player);
          }
        }
        return;
      }
      if (typeof players === 'object') {
        const vals = Object.values(players) as any[];
        for (const v of vals) {
          const pv: any = v as any;
          if (pv && typeof pv === 'object' && 'player' in pv) results.push((pv as any).player);
          else if (Array.isArray(pv)) {
            for (const sub of pv as any[]) if (sub && typeof sub === 'object' && 'player' in sub) results.push((sub as any).player);
          }
        }
        return;
      }
      if (players?.player) {
        results.push(players.player);
      }
    };
    if (Array.isArray(teamArr)) {
      for (const t of teamArr) {
        if (t?.roster) {
          const roster = t.roster;
          // Common shapes: roster[1].players, roster[0].players, roster.players, or object keyed indices
          const players = roster?.[1]?.players ?? roster?.[0]?.players ?? roster?.['0']?.players ?? roster?.players ?? null;
          if (players) collectFromPlayers(players);
        }
        // Some shapes embed directly
        if (t?.players) collectFromPlayers(t.players);
      }
    } else if (teamArr?.roster) {
      collectFromPlayers(teamArr.roster?.players);
    }
    return results;
  }

  private normalizeYahooPlayer(node: any): any {
    // Convert Yahoo 'player' node (which may be deeply nested arrays of key objects) into a flat object
    const acc: any = {};
    const mergeObj = (obj: any) => {
      if (!obj) return;
      Object.keys(obj).forEach((k) => {
        const v = obj[k];
        if (k in acc && typeof acc[k] === 'object' && typeof v === 'object') {
          acc[k] = { ...acc[k], ...v };
        } else {
          acc[k] = v;
        }
      });
    };
    const walk = (n: any) => {
      if (!n) return;
      if (Array.isArray(n)) {
        for (const item of n) {
          if (Array.isArray(item)) walk(item);
          else if (item && typeof item === 'object') mergeObj(item);
        }
      } else if (typeof n === 'object') {
        mergeObj(n);
      }
    };
    walk(node);
    return acc;
  }

}
