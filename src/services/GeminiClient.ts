import axios, { AxiosInstance } from 'axios';
import { ConfigManager } from './ConfigManager';
import { GeminiQuota } from './GeminiQuota';
import { AnalysisContext, BotConfig, LeagueSettings, LineupDecision } from '../models';
import { Player } from '../models/Player';
import { TradeDecision, WaiverDecision } from '../models/Decision';
import { GeminiLog } from './GeminiLog';

type GeminiTextResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

export interface GeminiClientOptions {
  apiKey?: string;
  model?: string; // e.g., gemini-2.5-pro
  baseUrl?: string; // e.g., https://generativelanguage.googleapis.com/v1beta
}

export class GeminiClient {
  private readonly http: AxiosInstance;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly quota: GeminiQuota;

  constructor(opts: GeminiClientOptions = {}) {
    // Prefer explicit option, then env, then secure store via ConfigManager
    let key = opts.apiKey ?? '';
    if (!key) {
      try {
        const cm = new ConfigManager();
        const creds = cm.loadGeminiCredentials();
        if (creds?.apiKey) key = creds.apiKey;
      } catch {}
    }
    this.apiKey = key;
    if (!this.apiKey) throw new Error('Gemini API key is required. Save it via the dashboard.');
    // Prefer model from stored creds; fallback to option or default
    let model = opts.model;
    if (!model) {
      try { const cm = new ConfigManager(); const creds = cm.loadGeminiCredentials(); model = creds?.model; } catch {}
    }
    this.model = model || 'gemini-2.5-pro';
    this.baseUrl = (opts.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    this.http = axios.create();
    this.quota = new GeminiQuota();
  }

  // --------- Public high-level helpers ---------
  async optimizeLineup(
    roster: Player[],
    leagueSettings: LeagueSettings,
    config: BotConfig,
    context: Omit<AnalysisContext, 'userPreferences'>
  ): Promise<LineupDecision> {
  const system = 'You are a fantasy football lineup optimizer. Incorporate current player news (injuries, practice reports, roster moves), matchup context, and league scoring rules when making recommendations. Respond with JSON only.';
    const user = this.buildLineupPrompt(roster, leagueSettings, context);
    const text = await this.generate(system, user, { kind: 'lineup', roster, leagueSettings, preferences: config, context });
    return this.parseJson<LineupDecision>(text, 'LineupDecision');
  }

  async evaluateWaiver(
    availablePlayers: Player[],
    config: BotConfig,
    maxClaims: number,
    context: Omit<AnalysisContext, 'userPreferences'>
  ): Promise<WaiverDecision> {
  const system = 'You are a fantasy football free-agent pickups strategist. Incorporate current player news (injuries, practice reports, roster moves), matchup context, and league scoring/roster rules. Respond with JSON only.';
    const user = this.buildWaiverPrompt(availablePlayers, maxClaims, context);
    const text = await this.generate(system, user, { kind: 'waivers', availablePlayers, preferences: config, maxClaims, context });
    return this.parseJson<WaiverDecision>(text, 'WaiverDecision');
  }

  // Immediate pickups (free agents now): require explicit dropPlayerId for each add
  async evaluateImmediatePickups(
    availablePlayers: Player[],
    myRoster: Player[],
    maxAdds: number,
    context: Omit<AnalysisContext, 'userPreferences'>
  ): Promise<WaiverDecision> {
  const system = 'You are a fantasy football free-agent pickups strategist. Incorporate current player news (injuries, practice reports, roster moves), matchup context, and league scoring/roster rules. Respond with JSON only.';
    const user = this.buildImmediatePickupPrompt(availablePlayers, myRoster, maxAdds, context);
    const text = await this.generate(system, user, { kind: 'pickups', availablePlayers, myRoster, maxAdds, context });
    return this.parseJson<WaiverDecision>(text, 'ImmediatePickups');
  }

  // Propose a single drop candidate from my roster for a given add
  async suggestDropForAdd(
    addPlayerId: string,
    myRoster: Player[],
    context: Omit<AnalysisContext, 'userPreferences'>
  ): Promise<{ dropPlayerId: string; reasoning: string }>{
  const system = 'You are a fantasy football roster manager. Incorporate current player news (injuries, practice reports, roster moves) and league scoring/roster configuration when recommending drops. Respond with JSON only.';
    const rosterLite = Array.isArray(myRoster)
      ? myRoster.map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, status: p.status }))
      : [];
    const lp: any = (context as any)?.leagueProfile;
    const scoring = lp?.scoring || {};
    const meta = lp?.meta || {};
    const user = [
      'Task: Choose exactly ONE player from my current roster to DROP to make room for the specified ADD.',
      'Constraints: dropPlayerId MUST be one of the ids in MyRoster JSON and MUST NOT equal the AddPlayerId. Return only ids, no names.',
      'Rules: Respond with JSON only. No commentary. Return a single object with dropPlayerId and reasoning.',
      'Schema: { "dropPlayerId": string, "reasoning": string }',
      '',
      `AddPlayerId: ${addPlayerId}`,
      'MyRoster JSON:',
      JSON.stringify(rosterLite, null, 2),
      'LeagueProfileMeta JSON:',
      JSON.stringify(meta, null, 2),
      'LeagueScoring JSON:',
      JSON.stringify(scoring, null, 2),
      'Context JSON:',
      JSON.stringify(context, null, 2),
    ].join('\n');
    const text = await this.generate(system, user, { kind: 'pickups-drop', addPlayerId, myRoster, context });
    return this.parseJson<{ dropPlayerId: string; reasoning: string }>(text, 'SuggestDrop');
  }

  async evaluateTrade(
    myRoster: Player[],
    theirRoster: Player[],
    config: BotConfig,
    context: Omit<AnalysisContext, 'userPreferences'>
  ): Promise<TradeDecision> {
  const system = 'You are a fantasy football trade evaluator. Incorporate current player news (injuries, practice reports, roster moves), upcoming schedule, and league scoring/roster rules when evaluating trades. Respond with JSON only.';
    const user = this.buildTradePrompt(myRoster, theirRoster, context);
    const text = await this.generate(system, user, { kind: 'trade', myRoster, theirRoster, preferences: config, context });
    return this.parseJson<TradeDecision>(text, 'TradeDecision');
  }

  async evaluateTradesMulti(
    myRoster: Player[],
    opponents: Array<{ teamKey: string; teamName?: string; roster: Player[] }>,
    config: BotConfig,
    context: Omit<AnalysisContext, 'userPreferences'>
  ): Promise<TradeDecision> {
  const system = 'You are a fantasy football trade strategist. Incorporate current player news (injuries, practice reports, roster moves), upcoming schedule, and league scoring/roster rules when evaluating multi-team trades. Respond with JSON only.';
    const user = this.buildTradeMultiPrompt(myRoster, opponents, context);
    const text = await this.generate(system, user, { kind: 'trade-multi', myRoster, opponentsCount: opponents.length, preferences: config, context });
    return this.parseJson<TradeDecision>(text, 'TradeDecisionMulti');
  }

  // --------- Previews (for diagnostics) ---------
  static previewLineup(
    roster: Player[],
    leagueSettings: LeagueSettings,
    context: Omit<AnalysisContext, 'userPreferences'>
  ): { system: string; user: string } {
  const system = 'You are a fantasy football lineup optimizer. Incorporate current player news (injuries, practice reports, roster moves), matchup context, and league scoring rules when making recommendations. Respond with JSON only.';
    // Inline prompt build to avoid requiring API key for previews
    const rosterLite = Array.isArray(roster)
      ? roster.map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, status: p.status }))
      : [];
    const rosterCount = Array.isArray(roster) ? roster.length : 0;
    const ctxAny: any = context as any;
    const withSlots: Array<{ slot?: string; player: Player }> = Array.isArray(ctxAny?.rosterWithSlots)
      ? ctxAny.rosterWithSlots
          .filter((e: any) => e && e.player)
          .map((e: any) => ({
            slot: e.slot,
            player: {
              id: e.player.id,
              name: e.player.name,
              position: e.player.position,
              team: e.player.team,
              status: e.player.status,
            } as Player,
          }))
      : [];
    const lp: any = (context as any)?.leagueProfile;
    const scoring = lp?.scoring || {};
    const meta = lp?.meta || {};
    const user = [
      'Task: Recommend an optimal starting lineup based on roster, league settings, and preferences.',
  'Guidance: Use the latest news and real-world context for each player (injuries, practice reports, suspensions, roster moves, projected snaps, matchup, and weather). Tailor decisions to the provided league scoring and roster setup (PPR, scoring weights, rosterPositions, bench size, and starting requirements). Prioritize short-term availability and matchup impact; when news conflicts, state which reports you relied on inside the reasoning fields.',
      'Rules: Respond with JSON only. No commentary. Follow schema exactly.',
      'Schema: { "recommendedLineup": { "starters": { [position: string]: any }, "bench": any[] }, "changes": Array<{ "position": string, "playerOut"?: any, "playerIn": any, "reasoning": string, "pointsImpact": number }>, "confidence": number, "reasoning": string, "projectedPoints": number }',
      '',
      `Roster Count: ${rosterCount}`,
      'Roster JSON:',
      JSON.stringify(rosterLite, null, 2),
      withSlots.length ? 'RosterWithSlots JSON:' : '',
      withSlots.length ? JSON.stringify(withSlots, null, 2) : '',
      'LeagueSettings JSON:',
      JSON.stringify(leagueSettings, null, 2),
      'LeagueProfileMeta JSON:',
      JSON.stringify(meta, null, 2),
      'LeagueScoring JSON:',
      JSON.stringify(scoring, null, 2),

      'Context JSON:',
      JSON.stringify(context, null, 2),
      rosterCount === 0 ? 'NOTE: roster array is empty. If no players provided, return a conservative no-change recommendation with low confidence.' : '',
    ].filter(Boolean).join('\n');
    return { system, user };
  }

  static previewWaivers(
    players: Player[],
    maxClaims: number,
    context: Omit<AnalysisContext, 'userPreferences'>
  ): { system: string; user: string } {
  const system = 'You are a fantasy football waiver-wire analyst. Incorporate current player news (injuries, practice reports, roster moves), matchup context, and league scoring/roster rules. Respond with JSON only.';
    const lite = Array.isArray(players)
      ? players.map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, status: p.status }))
      : [];
    const user = [
      'Task: Evaluate FREE AGENTS (not players on waivers) and propose up to maxClaims prioritized add/drop claims.',
      'Rules: Respond with JSON only. No commentary.',
      'Constraints: Only consider players who are immediate free agents and can be added now (not on waivers).',
      'Schema: { "claims": Array<{ "playerId": string, "dropPlayerId"?: string, "priority": number, "reasoning": string }>, "reasoning": string, "confidence": number, "expectedValue": number }',
      '',
      `Available Count: ${lite.length}`,
      'AvailablePlayers JSON:',
      JSON.stringify(lite, null, 2),

      'MaxClaims:',
      String(maxClaims),
      'Context JSON:',
      JSON.stringify(context, null, 2),
    ].join('\n');
    return { system, user };
  }

  static previewTrade(
    myRoster: Player[],
    theirRoster: Player[],
    context: Omit<AnalysisContext, 'userPreferences'>
  ): { system: string; user: string } {
    const system = 'You are a fantasy football trade evaluator. Respond with JSON only.';
    const mine = Array.isArray(myRoster)
      ? myRoster.map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, status: p.status }))
      : [];
    const theirs = Array.isArray(theirRoster)
      ? theirRoster.map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, status: p.status }))
      : [];
    const user = [
      'Task: Propose one or more mutually beneficial trades between two teams.',
      'Rules: Respond with JSON only. No commentary.',
      'Schema: { "shouldTrade": boolean, "reasoning": string, "confidence": number, "expectedValue": number, "proposal"?: { "myPlayers": string[], "theirPlayers": string[], "targetTeamId": string, "reasoning": string }, "proposals"?: Array<{ "myPlayers": string[], "theirPlayers": string[], "targetTeamId": string, "reasoning": string }> }',
      '',
      `My Count: ${mine.length}`,
      'MyRoster JSON:',
      JSON.stringify(mine, null, 2),
      `Their Count: ${theirs.length}`,
      'TheirRoster JSON:',
      JSON.stringify(theirs, null, 2),

      'Context JSON:',
      JSON.stringify(context, null, 2),
    ].join('\n');
    return { system, user };
  }

  // --------- Roster balance (needs/surplus) ---------
  async analyzeRosterBalance(
    roster: Player[],
    leagueSettings: LeagueSettings,
  ): Promise<{ needs: string[]; surplus: string[]; reasoning: string }> {
    const system = 'You are a fantasy football roster analyst. Respond with JSON only.';
    // Summarize counts by position
    const counts: Record<string, number> = {};
    for (const p of roster) {
      const pos = String(p.position);
      counts[pos] = (counts[pos] ?? 0) + 1;
    }
    const starters = leagueSettings?.rosterPositions || {} as Record<string, number>;
    const userParts = [
      'Task: Identify positional needs and surplus for trades based on roster depth vs league lineup requirements.',
      'Rules: Respond with JSON only. No commentary beyond a brief reasoning string.',
      'Schema: { "needs": string[], "surplus": string[], "reasoning": string }',
      '',
      'LeagueRosterPositions JSON:',
      JSON.stringify(starters, null, 2),
      'MyRosterCounts JSON:',
      JSON.stringify(counts, null, 2),
      'MyRosterPlayers JSON:',
      JSON.stringify(roster.map(p => ({ id: p.id, name: p.name, position: p.position, team: p.team })), null, 2),
    ];
    const user = userParts.join('\n');
    const text = await this.generate(system, user, { kind: 'needs-surplus', leagueSettings, rosterCounts: counts });
    return this.parseJson<{ needs: string[]; surplus: string[]; reasoning: string }>(text, 'RosterBalance');
  }

  async evaluateIncomingTradeOffer(
    myRoster: Player[],
    leagueSettings: LeagueSettings,
    needs: string[],
    surplus: string[],
    moves: Array<{ playerId?: string; name?: string; position?: string; source?: string; destination?: string; type?: string }>,
    myTeamKey: string,
    leagueProfile?: any
  ): Promise<{ shouldAccept: boolean; reasoning: string; confidence: number }>{
    const system = 'You are a fantasy football trade evaluator. Respond with JSON only.';
    const incoming = moves.filter(m => (m.destination || '').includes('.t.') ? (m.destination === myTeamKey || ((): boolean => {
      const idx = myTeamKey.lastIndexOf('.t.'); if (idx <= 0) return false; const myNum = myTeamKey.slice(idx+3); return (m.destination || '').endsWith('.t.'+myNum);
    })()) : false);
    const outgoing = moves.filter(m => (m.source || '').includes('.t.') ? (m.source === myTeamKey || ((): boolean => {
      const idx = myTeamKey.lastIndexOf('.t.'); if (idx <= 0) return false; const myNum = myTeamKey.slice(idx+3); return (m.source || '').endsWith('.t.'+myNum);
    })()) : false);
    const lp: any = leagueProfile;
    const scoring = lp?.scoring || {};
    const meta = lp?.meta || {};
    const userParts = [
      'Task: Decide whether to ACCEPT or DECLINE an incoming trade offer for my team based on positional needs/surplus and league lineup requirements.',
      'Rules: Respond with JSON only. Be conservative unless the trade clearly improves roster balance and expected utility.',
      'Schema: { "shouldAccept": boolean, "reasoning": string, "confidence": number }',
      '',
      'Needs JSON:', JSON.stringify(needs || [], null, 2),
      'Surplus JSON:', JSON.stringify(surplus || [], null, 2),
      'LeagueRosterPositions JSON:', JSON.stringify(leagueSettings?.rosterPositions || {}, null, 2),
      'LeagueProfileMeta JSON:', JSON.stringify(meta, null, 2),
      'LeagueScoring JSON:', JSON.stringify(scoring, null, 2),
      'MyIncomingPlayers JSON:', JSON.stringify(incoming.map(p => ({ id: p.playerId, name: p.name, position: p.position })), null, 2),
      'MyOutgoingPlayers JSON:', JSON.stringify(outgoing.map(p => ({ id: p.playerId, name: p.name, position: p.position })), null, 2),
      'Roster Snapshot JSON:', JSON.stringify(myRoster.map(p => ({ id: p.id, name: p.name, position: p.position })), null, 2),
    ];
    const user = userParts.join('\n');
    const text = await this.generate(system, user, { kind: 'incoming-trade-eval', needs, surplus, leagueSettings, moves, leagueProfile });
    return this.parseJson<{ shouldAccept: boolean; reasoning: string; confidence: number }>(text, 'IncomingTradeDecision');
  }
  previewLineupPrompt(
    roster: Player[],
    leagueSettings: LeagueSettings,
    context: Omit<AnalysisContext, 'userPreferences'>
  ): { system: string; user: string } {
    return GeminiClient.previewLineup(roster, leagueSettings, context);
  }

  // --------- Core API call ---------
  async generate(system: string, user: string, inputs?: any): Promise<string> {
    if (!this.quota.tryConsume(1)) {
      const err = new Error(`Gemini daily quota exceeded (limit=${this.quota.getLimit()})`);
      try { GeminiLog.record({ ts: new Date().toISOString(), system, user, response: 'ERROR: quota exceeded', inputs }); } catch {}
      throw err;
    }
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(
      this.apiKey,
    )}`;
    // Use systemInstruction for clearer role separation in Gemini API
    const body: any = {
      systemInstruction: { role: 'system', parts: [{ text: system }] },
      contents: [ { role: 'user', parts: [{ text: user }] } ],
      generationConfig: { temperature: 0.2 },
    };
    // Pre-log request for visibility
    try { GeminiLog.record({ ts: new Date().toISOString(), system, user, response: '', inputs }); } catch {}
    try {
      const { data } = await this.http.post<GeminiTextResponse>(url, body, {
        headers: { 'Content-Type': 'application/json' },
      });
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      if (!text) throw new Error('Empty response from Gemini');
      try { GeminiLog.record({ ts: new Date().toISOString(), system, user, response: text, inputs }); } catch {}
      return text;
    } catch (err: any) {
      // Log error details to gemini log for diagnostics
      const msg = err?.response?.data ? JSON.stringify(err.response.data) : (err?.message || String(err));
      try { GeminiLog.record({ ts: new Date().toISOString(), system, user, response: `ERROR: ${msg}`, inputs }); } catch {}
      throw err;
    }
  }

  // --------- Prompt builders ---------
  private buildLineupPrompt(
    roster: Player[],
    leagueSettings: LeagueSettings,
    context: Omit<AnalysisContext, 'userPreferences'>
  ): string {
    const rosterLite = Array.isArray(roster)
      ? roster.map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, status: p.status }))
      : [];
    const rosterCount = Array.isArray(roster) ? roster.length : 0;
    // Try to pick up slot-aware roster if controller provided it in context
    const ctxAny: any = context as any;
    const withSlots: Array<{ slot?: string; player: Player }> = Array.isArray(ctxAny?.rosterWithSlots)
      ? ctxAny.rosterWithSlots
          .filter((e: any) => e && e.player)
          .map((e: any) => ({
            slot: e.slot,
            player: {
              id: e.player.id,
              name: e.player.name,
              position: e.player.position,
              team: e.player.team,
              status: e.player.status,
            } as Player,
          }))
      : [];
    const lp: any = (context as any)?.leagueProfile;
    const scoring = lp?.scoring || {};
    const meta = lp?.meta || {};
    return [
      'Task: Recommend an optimal starting lineup based on roster, league settings, and preferences.',
      'Guidance: Use the latest news/data for each player to determine the fantasy lineup based on the provided league setup. Infer positional priorities from roster balance (depth vs required starters) and league rosterPositions. Do not rely on any points fields in the input or any fixed/static priorities.',
      'Rules: Respond with JSON only. No commentary. Follow schema exactly.',
      'Schema: { "recommendedLineup": { "starters": { [position: string]: any }, "bench": any[] }, "changes": Array<{ "position": string, "playerOut"?: any, "playerIn": any, "reasoning": string, "pointsImpact": number }>, "confidence": number, "reasoning": string, "projectedPoints": number }',
      '',
      `Roster Count: ${rosterCount}`,
      'Roster JSON:',
      JSON.stringify(rosterLite, null, 2),
      withSlots.length ? 'RosterWithSlots JSON:' : '',
      withSlots.length ? JSON.stringify(withSlots, null, 2) : '',
      'LeagueSettings JSON:',
      JSON.stringify(leagueSettings, null, 2),
      'LeagueProfileMeta JSON:',
      JSON.stringify(meta, null, 2),
      'LeagueScoring JSON:',
      JSON.stringify(scoring, null, 2),

      'Context JSON:',
      JSON.stringify(context, null, 2),
      rosterCount === 0 ? 'NOTE: roster array is empty. If no players provided, return a conservative no-change recommendation with low confidence.' : '',
    ].filter(Boolean).join('\n');
  }

  private buildWaiverPrompt(
    players: Player[],
    maxClaims: number,
    context: Omit<AnalysisContext, 'userPreferences'>
  ): string {
    const lite = Array.isArray(players)
      ? players.map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, status: p.status }))
      : [];
    const faab = (context as any)?.faabBudgetRemaining;
    const week = (context as any)?.week;
    const endWeek = (() => {
      const pw = (context as any)?.leagueSettings?.playoffWeeks;
      if (Array.isArray(pw) && pw.length > 0) return Math.min(...pw) - 1;
      return undefined;
    })();
    const lp: any = (context as any)?.leagueProfile;
    const scoring = lp?.scoring || {};
    const meta = lp?.meta || {};
    const guidance = [
      'Task: Evaluate waiver wire players and propose up to maxClaims prioritized claims.',
      'Guidance: Infer positional priorities and team needs from roster depth vs league rosterPositions. Prefer upgrades that improve near-term starters and roster balance. Do not use fixed/static priorities.',
      'Rules: Respond with JSON only. No commentary.',
      'Schema: { "claims": Array<{ "playerId": string, "dropPlayerId"?: string, "priority": number, "reasoning": string, "bidAmount"?: number }>, "reasoning": string, "confidence": number, "expectedValue": number }',
    ];
    if (Number.isFinite(faab)) {
      guidance.push(`Bidding: Use bidAmount per claim based on remaining FAAB (${faab}). ` +
        `Do not exceed remaining FAAB on any single bid. Consider weeks left (current week ${week}${endWeek ? `, end week ${endWeek}` : ''}) to scale bids; higher priority claims can bid slightly more.`);
    }
    return [
      ...guidance,
      '',
      `Available Count: ${lite.length}`,
      'AvailablePlayers JSON:',
      JSON.stringify(lite, null, 2),
      'LeagueProfileMeta JSON:',
      JSON.stringify(meta, null, 2),
      'LeagueScoring JSON:',
      JSON.stringify(scoring, null, 2),

      'MaxClaims:',
      String(maxClaims),
      'Context JSON:',
      JSON.stringify(context, null, 2),
    ].join('\n');
  }

  private buildImmediatePickupPrompt(
    availablePlayers: Player[],
    myRoster: Player[],
    maxAdds: number,
    context: Omit<AnalysisContext, 'userPreferences'>
  ): string {
    const availableLite = Array.isArray(availablePlayers)
      ? availablePlayers.map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, status: p.status }))
      : [];
    const rosterLite = Array.isArray(myRoster)
      ? myRoster.map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, status: p.status }))
      : [];
    const lp: any = (context as any)?.leagueProfile;
    const scoring = lp?.scoring || {};
    const meta = lp?.meta || {};
    return [
      'Task: Recommend immediate FREE-AGENT pickups (not waivers) and specify exactly which current rostered players to DROP for each ADD.',
      'Guidance: Prioritize near-term impact and positional needs. You MUST include a dropPlayerId for every claim. Order by priority (1 = highest). Do not include bidAmount.',
      'Constraints: dropPlayerId MUST be one of the ids in MyRoster JSON and MUST NOT equal the playerId being added. Return only ids, no names.',
      'Rules: Respond with JSON only. No commentary.',
      'Schema: { "claims": Array<{ "playerId": string, "dropPlayerId": string, "priority": number, "reasoning": string }>, "reasoning": string, "confidence": number, "expectedValue": number }',
      '',
      `MaxAdds: ${maxAdds}`,
      'AvailablePlayers JSON:',
      JSON.stringify(availableLite, null, 2),
      'MyRoster JSON:',
      JSON.stringify(rosterLite, null, 2),
      'LeagueProfileMeta JSON:',
      JSON.stringify(meta, null, 2),
      'LeagueScoring JSON:',
      JSON.stringify(scoring, null, 2),
      'Context JSON:',
      JSON.stringify(context, null, 2),
    ].join('\n');
  }

  private buildTradePrompt(
    myRoster: Player[],
    theirRoster: Player[],
    context: Omit<AnalysisContext, 'userPreferences'>
  ): string {
    const mine = Array.isArray(myRoster)
      ? myRoster.map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, status: p.status }))
      : [];
    const theirs = Array.isArray(theirRoster)
      ? theirRoster.map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, status: p.status }))
      : [];
    const lp: any = (context as any)?.leagueProfile;
    const scoring = lp?.scoring || {};
    const meta = lp?.meta || {};
    return [
      'Task: Propose one or more mutually beneficial trades between two teams.',
      'Guidance: Infer my positional needs/surplus from roster depth vs required starters. Prefer trades that improve expected utility and roster balance. Be realistic with few players per side. If recommending multiple, order by expected value.',
      'Rules: Respond with JSON only. No commentary.',
      'Schema: { "shouldTrade": boolean, "reasoning": string, "confidence": number, "expectedValue": number, "proposal"?: { "myPlayers": string[], "theirPlayers": string[], "targetTeamId": string, "reasoning": string }, "proposals"?: Array<{ "myPlayers": string[], "theirPlayers": string[], "targetTeamId": string, "reasoning": string }> }',
      '',
      `My Count: ${mine.length}`,
      'MyRoster JSON:',
      JSON.stringify(mine, null, 2),
      `Their Count: ${theirs.length}`,
      'TheirRoster JSON:',
      JSON.stringify(theirs, null, 2),
      'LeagueProfileMeta JSON:',
      JSON.stringify(meta, null, 2),
      'LeagueScoring JSON:',
      JSON.stringify(scoring, null, 2),

      'Context JSON:',
      JSON.stringify(context, null, 2),
    ].join('\n');
  }

  private buildTradeMultiPrompt(
    myRoster: Player[],
    opponents: Array<{ teamKey: string; teamName?: string; roster: Player[] }>,
    context: Omit<AnalysisContext, 'userPreferences'>
  ): string {
    const mine = Array.isArray(myRoster)
      ? myRoster.map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, status: p.status }))
      : [];
    const opps = Array.isArray(opponents)
      ? opponents.map((o) => ({
          teamKey: o.teamKey,
          teamName: o.teamName,
          roster: (o.roster || []).map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, status: p.status })),
        }))
      : [];
    const lp: any = (context as any)?.leagueProfile;
    const scoring = lp?.scoring || {};
    const meta = lp?.meta || {};
    return [
      'Task: From my roster and opponent rosters, propose up to 3 mutually beneficial trades (can be with one or multiple opponents).',
      'Guidance: Infer my positional needs/surplus from roster depth vs required starters. Prefer trades that improve expected utility and roster balance. Use few players per side. If shouldTrade is true, you MUST include either a proposal or a proposals array (ordered by expected value).',
      'Rules: Respond with JSON only. No commentary.',
      'Schema: { "shouldTrade": boolean, "reasoning": string, "confidence": number, "expectedValue": number, "proposal"?: { "myPlayers": string[], "theirPlayers": string[], "targetTeamId": string, "reasoning": string }, "proposals"?: Array<{ "myPlayers": string[], "theirPlayers": string[], "targetTeamId": string, "reasoning": string }> }',
      '',
      `My Count: ${mine.length}`,
      'MyRoster JSON:',
      JSON.stringify(mine, null, 2),
      `Opponents Count: ${opps.length}`,
      'Opponents JSON:',
      JSON.stringify(opps, null, 2),
      'LeagueProfileMeta JSON:',
      JSON.stringify(meta, null, 2),
      'LeagueScoring JSON:',
      JSON.stringify(scoring, null, 2),

      'Context JSON:',
      JSON.stringify(context, null, 2),
    ].join('\n');
  }

  // --------- Parsing helpers ---------
  private parseJson<T>(text: string, label: string): T {
    // Try direct parse, else extract from fenced code blocks
    const tryParse = (s: string) => {
      const trimmed = s.trim();
      if (trimmed.startsWith('```')) {
        const content = trimmed.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '');
        return JSON.parse(content);
      }
      return JSON.parse(trimmed);
    };
    try {
      const obj = tryParse(text);
      return obj as T;
    } catch (e) {
      // Last resort: find first JSON object
      const m = text.match(/[\{\[].*[\}\]]/s);
      if (m) {
        return JSON.parse(m[0]) as T;
      }
      throw new Error(`Failed to parse ${label} from Gemini response`);
    }
  }
}
