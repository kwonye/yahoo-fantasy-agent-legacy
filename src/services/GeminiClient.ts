import { ConfigManager } from './ConfigManager';
import { GeminiQuota } from './GeminiQuota';
import { AnalysisContext, BotConfig, LeagueSettings, LineupDecision } from '../models';
import { Player } from '../models/Player';
import { TradeDecision, WaiverDecision } from '../models/Decision';
import { GeminiLog } from './GeminiLog';
import { GoogleGenAI } from '@google/genai';

export interface GeminiClientOptions {
  apiKey?: string;
  model?: string; // e.g., gemini-2.5-pro
  baseUrl?: string; // e.g., https://generativelanguage.googleapis.com/v1beta
}

export class GeminiClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly quota: GeminiQuota;
  private readonly genAI: GoogleGenAI;

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
    this.quota = new GeminiQuota();
    this.genAI = new GoogleGenAI({
      apiKey: this.apiKey,
    });
  }

  // --------- Public high-level helpers ---------
  async optimizeLineup(
    roster: Player[],
    leagueSettings: LeagueSettings,
    config: BotConfig,
    context: Omit<AnalysisContext, 'userPreferences'>
  ): Promise<LineupDecision> {
  const system = [
    'You are an elite fantasy football coach and projection analyst.',
    'Always ground recommendations in the provided data: player status, team usage trends, matchup difficulty, bye weeks, and league scoring settings.',
    'Prefer high-upside starters when projections are close, but never leave safer locked-in production on the bench without justification.',
    'Only reference injuries, practice updates, or news items that appear in the supplied context; if no update exists, explicitly note the uncertainty instead of inventing details.',
    'You MUST call the Google Search tool to gather the latest context before responding and integrate those findings with the provided data (mention when the search yields nothing new).',
    'Never invent player ids, names, or statistics. Output valid JSON only.'
  ].join('\n');
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
  const system = [
    'You are an elite fantasy football acquisitions strategist focused on waiver priorities.',
    'Use the supplied data (player status, depth chart context, matchup, bye week schedule, league scoring) to rank claims that maximize rest-of-season and short-term value.',
    'Avoid suggesting players that conflict with roster constraints (e.g., too many at one position unless clearly necessary).',
    'Only reference injuries, beat-reporter notes, or usage trends when they exist in the provided context; otherwise acknowledge that recent news is unavailable.',
    'You MUST call the Google Search tool to gather the latest context before responding and integrate those findings with the provided data, noting when the search yields nothing useful.',
    'Respond with strictly valid JSON. Never fabricate ids or players.'
  ].join('\n');
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
  const system = [
    'You are a fantasy football acquisitions strategist tasked with immediate add/drop moves.',
    'Respect roster constraints and ensure every recommended add includes a legal drop candidate from the current roster.',
    'Factor in short-term opportunity, upside, bye weeks, injuries, and league scoring nuances.',
    'Only reference current injury/practice news when the data is supplied or when retrieved via the Google Search tool; if no update exists, explicitly note that instead of inventing details.',
    'You MUST call the Google Search tool to gather current context before responding and augment the provided data with any relevant findings (state when the search returns nothing).',
    'Output valid JSON only. Never fabricate player identifiers.'
  ].join('\n');
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
  const system = [
    'You are a fantasy football roster surgeon who suggests the single best drop for a pending add.',
    'Use player health, usage trends, positional scarcity, bye weeks, and league scoring to minimize downside.',
    'Only reference injury or practice updates that appear in the provided data or when retrieved via the Google Search tool; if none are supplied, explicitly note the uncertainty instead of inventing news.',
    'You MUST call the Google Search tool to gather current context before responding and incorporate any relevant findings alongside the provided data (mention when search yields nothing).',
    'Only reference players that exist in the provided roster. Output valid JSON and never invent identifiers.'
  ].join('\n');
    const rosterLite = Array.isArray(myRoster)
      ? myRoster.map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, status: p.status }))
      : [];
    const lp: any = (context as any)?.leagueProfile;
    const scoring = lp?.scoring || {};
    const meta = lp?.meta || {};
    const user = [
      'Task: Choose exactly ONE player from my current roster to DROP to make room for the specified ADD.',
      'Constraints: dropPlayerId MUST be one of the ids in MyRoster JSON and MUST NOT equal the AddPlayerId. Return only ids, no names.',
      'Guidance: Base the decision on provided status/practice notes and long-term role security; if no recent update exists, state that explicitly rather than inventing news.',
      'You MUST call the Google Search tool before finalizing the recommendation and augment the provided data with any relevant snippets (note when nothing useful is found).',
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
  const system = [
    'You are a fantasy football trade evaluator.',
    'Incorporate current player news (injuries, practice reports, roster moves), upcoming schedule, and league scoring/roster rules when evaluating trades.',
    'You MUST call the Google Search tool before responding to gather the latest context and integrate those findings with the provided data (note when the search yields nothing useful).',
    'Respond with JSON only.'
  ].join('\n');
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
  const system = [
    'You are a fantasy football trade strategist.',
    'Incorporate current player news (injuries, practice reports, roster moves), upcoming schedule, and league scoring/roster rules when evaluating multi-team trades.',
    'You MUST call the Google Search tool before responding to gather the latest context and integrate those findings with the provided data (note when the search yields nothing useful).',
    'Respond with JSON only.'
  ].join('\n');
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
    const system = [
      'You are an elite fantasy football trade architect and analyst.',
      'Use roster balance, positional scarcity, player health, upcoming schedules, and league scoring to craft fair, realistic trades.',
      'Never propose lopsided or impossible deals (e.g., duplicate players, bye-week overload). Output valid JSON only.',
      'Only reference injuries or news if they are explicitly present in the provided context; otherwise mention that no recent update is available.',
      'Invoke the Google Search tool whenever additional or real-time context is required and integrate any relevant findings with the provided data (note when nothing useful is discovered).'
    ].join('\n');
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
    const system = [
      'You are a fantasy football roster balance analyst.',
      'Compare roster depth to required starters, factoring positional scarcity, injuries, and bye-week exposure to flag needs and surplus.',
      'Reference current news or injuries only if the input provides them; otherwise disclose that the data is not available.',
      'You MUST call the Google Search tool to gather additional context and blend any relevant findings with the provided data (note when search yields nothing).',
      'Respond with concise JSON only. Do not fabricate players or stats.'
    ].join('\n');
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
      'Guidance: Use provided status/injury notes; if no recent information is available, acknowledge the uncertainty instead of inventing updates.',
      'You MUST call the Google Search tool before finalizing this analysis and augment the provided data with any useful snippets (and note when the search adds nothing new).',
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
    const system = [
      'You are a fantasy football trade evaluator deciding whether to accept an incoming offer.',
      'Consider roster needs/surplus, player health, usage trends, upcoming schedule difficulty, and league scoring to judge benefit vs risk.',
      'Be conservative unless the trade clearly improves expected outcomes. Output valid JSON only.',
      'Only cite news or injury updates when they appear in the provided context or when retrieved via the Google Search tool.',
      'You MUST call the Google Search tool before responding and incorporate any relevant findings with the provided data (noting when search yields nothing new).'
    ].join('\n');
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
      'Task: Decide whether to ACCEPT or DECLINE this incoming trade offer.',
      'Guidelines:',
      '- Use my needs/surplus, positional scarcity, player health, usage trends, and upcoming schedules to judge value.',
      '- Decline if the trade increases risk, erodes depth, or fails to improve projected outcomes.',
      '- Flag salary/keeper or FAAB notes only if present in the data or when retrieved via the Google Search tool; otherwise keep reasoning concise.',
      '- ALWAYS call the Google Search tool to augment your evaluation, weaving any useful findings into the reasoning while noting when search uncovers nothing new.',
      '- Output valid JSON only and never fabricate players or metrics.',
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
    const useSearch = this.shouldUseSearch(inputs?.kind);
    const tools = useSearch ? [{ googleSearch: {} }] : undefined;
    const thinkingConfig = useSearch ? { thinkingBudget: -1 } : undefined;

    const request = {
      model: this.model,
      contents: [
        {
          role: 'user',
          parts: [{ text: user }],
        },
      ],
      config: {
        systemInstruction: { role: 'system', parts: [{ text: system }] },
        generationConfig: { temperature: 0.2 },
        ...(tools ? { tools } : {}),
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    };

    // Pre-log request for visibility
    try { GeminiLog.record({ ts: new Date().toISOString(), system, user, response: '', inputs }); } catch {}
    try {
      const stream = await this.genAI.models.generateContentStream(request);
      let text = '';
      for await (const chunk of stream) {
        text += this.extractText(chunk);
      }
      if (!text.trim()) throw new Error('Empty response from Gemini');
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
      'Task: Produce the optimal starting lineup for the upcoming scoring period.',
      'Key guidelines:',
      '- Respect positional eligibility and ensure no illegal starters. Do not bench locked-in elite production without clear reason.',
      '- Avoid starting players on BYE/OUT/SUSP/IR statuses unless absolutely no legal alternative exists.',
      '- Leverage matchup difficulty, offensive/defensive pace, recent usage (snap share, targets, carries), injury trends, and weather if provided.',
      '- Highlight swaps only when the expected benefit (floor + ceiling) outweighs risk. Bench list should be ordered by next-man-up importance (handcuffs, upside stashes, depth).',
      '- When citing injuries or news, only reference details present in the provided data or when retrieved via the Google Search tool; if none exist, explicitly note that no recent update is available.',
      '- ALWAYS call the Google Search tool before finalizing recommendations and blend any useful findings with the provided data (state when the search yields nothing relevant).',
      '- Never invent player ids, names, or statistics; stay within provided data.',
      'Rules: Output strictly valid JSON following schema { "recommendedLineup": { "starters": { [position: string]: any }, "bench": any[] }, "changes": Array<{ "position": string, "playerOut"?: any, "playerIn": any, "reasoning": string, "pointsImpact": number }>, "confidence": number, "reasoning": string, "projectedPoints": number }',
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
    const guidance: string[] = [
      'Task: Rank the waiver priorities (up to maxClaims) that most improve this roster.',
      'Guidelines:',
      '- Start with positional needs, injury insurance, bye-week coverage, and upside relative to league scoring.',
      '- Emphasize players with tangible roles (volume / red-zone / target share) or high-upside stashes when floor options are exhausted.',
      '- Include dropPlayerId only when the roster is full; never drop a player you plan to add or someone essential for positional minimums.',
      '- Sort claims by priority (1 = highest). Each player id may appear at most once. Avoid recommending players already on the roster.',
      '- Provide concise reasoning referencing matchup, depth chart signals, or rest-of-season outlook.',
      '- Call the Google Search tool whenever you need fresh intel and limit your reasoning to the information returned.',
      '- When mentioning injuries or news, only reference details provided in the data or when retrieved via the Google Search tool; if no update is supplied, explicitly state that the latest news is unavailable.',
      '- Output valid JSON only and do not fabricate ids or stats.',
      'Schema: { "claims": Array<{ "playerId": string, "dropPlayerId"?: string, "priority": number, "reasoning": string, "bidAmount"?: number }>, "reasoning": string, "confidence": number, "expectedValue": number }',
    ];
    if (Number.isFinite(faab)) {
      guidance.push(`FAAB guidance: remaining budget ${faab}. Scale bidAmount by urgency (current week ${week ?? 'N/A'}${endWeek ? `, playoffs start ~week ${endWeek + 1}` : ''}). Never exceed the remaining FAAB for any claim.`);
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
      'Task: Recommend immediate FREE-AGENT add/drop moves (no waiver priority).',
      'Guidelines:',
      '- Limit output to maxAdds moves and ensure each add has a dropPlayerId pulled from MyRoster JSON.',
      '- Maintain roster legality: avoid leaving positions empty or dropping high-value starters without clear upgrades.',
      '- Prioritize players who can contribute right away, cover upcoming byes/injuries, or deliver meaningful upside.',
      '- Order claims by priority (1 = highest). Do not list the same player or drop twice.',
      '- Reference injury/news context only when present in the data or when retrieved via the Google Search tool; otherwise state that no recent update exists.',
      '- ALWAYS call the Google Search tool before finalizing recommendations and augment the provided data with any relevant snippets (note when nothing new surfaces).',
      '- Output valid JSON only and never fabricate player identifiers.',
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
      'Task: Propose a realistic, mutually beneficial trade with this specific opponent.',
      'Guidelines:',
      '- Diagnose my roster needs/surplus vs required starters, then identify how the opponent can help while also improving their roster.',
      '- Keep proposals concise (generally 1-2 players per side) and avoid duplicating players or suggesting assets neither team owns.',
      '- Reference usage trends, role stability, upcoming schedule, and league scoring to justify the swap.',
      '- If multiple trades are suggested, order them by descending expected value for my team.',
      '- When citing injury or news context, only use details present in the supplied data or when retrieved via the Google Search tool; otherwise state that no recent update is available.',
      '- ALWAYS call the Google Search tool before finalizing proposals and integrate useful snippets with the provided data while mentioning if search produced no additional information.',
      '- Output valid JSON only; never fabricate player ids or team identifiers.',
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
      'Task: Evaluate the league and recommend up to 3 realistic trades (possibly different opponents) that materially improve my roster.',
      'Guidelines:',
      '- Identify my biggest needs and surplus positions, then match them against opponents’ weaknesses/strengths.',
      '- Keep each proposal short (1-2 players per side) and avoid repeating identical packages or suggesting players I already roster.',
      '- Order multiple proposals by descending expected value and provide concise, evidence-based reasoning for each.',
      '- Reference any injury or news items only when present in the provided data or when retrieved via the Google Search tool; otherwise explain that recent updates are unavailable.',
      '- ALWAYS call the Google Search tool before finalizing proposals and augment the analysis with any relevant findings (and note when search yields nothing meaningful).',
      '- Output strictly valid JSON with the schema below; never fabricate players or team ids.',
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

  private extractText(chunk: any): string {
    if (!chunk) return '';
    if (typeof chunk.text === 'string') return chunk.text;
    if (Array.isArray(chunk.candidates)) {
      return chunk.candidates
        .map((candidate: any) =>
          Array.isArray(candidate?.content?.parts)
            ? candidate.content.parts.map((part: any) => part?.text ?? '').join('')
            : '',
        )
        .join('');
    }
    return '';
  }

  private shouldUseSearch(_kind?: string): boolean {
    return true;
  }
}
