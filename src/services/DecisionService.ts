import { BotConfig } from '../models/Config';
import { LeagueSettings } from '../models/Team';
import { LineupDecision } from '../models/Lineup';
import { Player } from '../models/Player';
import { TradeDecision, WaiverDecision } from '../models/Decision';
import { AnalysisContext } from '../models/Config';
import { GeminiClient } from './GeminiClient';

export interface DecisionServiceOptions {
  minConfidence?: number; // general minimum confidence to accept Gemini decisions
}

export class DecisionService {
  private readonly gemini: GeminiClient;
  private readonly config: BotConfig;
  private readonly minConfidence: number;

  constructor(gemini: GeminiClient, config: BotConfig, opts: DecisionServiceOptions = {}) {
    this.gemini = gemini;
    this.config = config;
    this.minConfidence = opts.minConfidence ?? 0.5;
  }

  async decideLineup(
    roster: Player[],
    leagueSettings: LeagueSettings,
    context: Omit<AnalysisContext, 'userPreferences'>
  ): Promise<LineupDecision> {
    const raw = await this.gemini.optimizeLineup(roster, leagueSettings, this.config, context);
    // Validate minimal fields and confidence
    const confidence = clamp(raw.confidence ?? 0, 0, 1);
    const projectedPoints = typeof raw.projectedPoints === 'number' ? raw.projectedPoints : 0;
    const validated: LineupDecision = {
      recommendedLineup: raw.recommendedLineup ?? { starters: {}, bench: [] },
      changes: raw.changes ?? [],
      confidence,
      reasoning: raw.reasoning ?? 'No reasoning provided',
      projectedPoints,
    };
    return validated;
  }

  async decideWaivers(
    availablePlayers: Player[],
    context: Omit<AnalysisContext, 'userPreferences'>
  ): Promise<WaiverDecision> {
    if (!this.config.waiverWireEnabled) {
      return { claims: [], reasoning: 'Waiver wire disabled by configuration', confidence: 1, expectedValue: 0 };
    }
    const raw = await this.gemini.evaluateWaiver(
      availablePlayers,
      this.config,
      this.config.maxWaiverClaims,
      context
    );

    // Enforce constraints: number of claims, confidence threshold
    const confidence = clamp(raw.confidence ?? 0, 0, 1);
    let claims = Array.isArray(raw.claims) ? raw.claims.slice(0) : [];
    // Cap total claims to league weekly acquisitions limit if provided by league profile
    try {
      const lp: any = (context as any).leagueProfile;
      const maxWeek: number | undefined = Number.isFinite(Number(lp?.meta?.maxAcquisitionsWeek)) ? Number(lp.meta.maxAcquisitionsWeek) : undefined;
      if (Number.isFinite(maxWeek as any)) {
        const cap = Math.max(0, Math.min(this.config.maxWaiverClaims, Number(maxWeek)));
        claims = claims.slice(0, cap);
      }
    } catch {}

    // Filter out claims that drop never-drop players, if configured
    const neverDrop = Array.isArray((this.config as any).neverDrop) ? (this.config as any).neverDrop as string[] : [];
    if (neverDrop.length > 0) {
      claims = claims.filter((c) => !c.dropPlayerId || !neverDrop.includes(String(c.dropPlayerId)));
    }
    // If league disallows injured adds, filter out claims adding clearly injured/IR players
    try {
      const lp: any = (context as any).leagueProfile;
      const disallowInjured = lp?.meta?.allowInjuredAdds === false;
      if (disallowInjured && Array.isArray(availablePlayers)) {
        const byId = new Map<string, Player>();
        for (const p of availablePlayers) byId.set(String(p.id), p);
        const isInjured = (p?: Player) => {
          const s = String(p?.status || '').toUpperCase();
          return s.includes('IR') || s.includes('INJ') || s === 'O' || s === 'OUT' || s === 'D' || s === 'DOUBTFUL';
        };
        claims = claims.filter((c) => {
          const p = byId.get(String(c.playerId));
          return !isInjured(p);
        });
      }
    } catch {}
    // Ensure priorities are numbers, default high priority 0 (lower is worse). Sort by priority ascending (1 highest).
    claims = claims
      .map((c) => ({ ...c, priority: toNumber(c.priority, 0) }))
      .sort((a, b) => a.priority - b.priority)
      .slice(0, Math.max(0, this.config.maxWaiverClaims));

    // Cap any provided bidAmount to available FAAB (if provided in context)
    const faabRemain = toNumber((context as any).faabBudgetRemaining, NaN);
    if (Number.isFinite(faabRemain)) {
      claims = claims.map((c) => ({
        ...c,
        bidAmount: c.bidAmount !== undefined ? Math.max(0, Math.min(toNumber(c.bidAmount, 0), faabRemain)) : c.bidAmount,
      }));
    }
    const expectedValue = toNumber(raw.expectedValue, 0);
    const reasoning = raw.reasoning ?? 'No reasoning provided';
    return { claims, reasoning, confidence, expectedValue };
  }

  async decideTrade(
    myRoster: Player[],
    theirRoster: Player[],
    context: Omit<AnalysisContext, 'userPreferences'>
  ): Promise<TradeDecision> {
    if (!this.config.tradingEnabled) {
      return { shouldTrade: false, reasoning: 'Trading disabled by configuration', confidence: 1, expectedValue: 0 };
    }
    const raw = await this.gemini.evaluateTrade(myRoster, theirRoster, this.config, context);
    const confidence = clamp(raw.confidence ?? 0, 0, 1);
    const expectedValue = toNumber(raw.expectedValue, 0);

    // Apply trade threshold gating
    const meetsThreshold = expectedValue >= (this.config.tradeThreshold ?? 0);
    const shouldTrade = Boolean(raw.shouldTrade) && meetsThreshold && confidence >= this.minConfidence;

    return {
      proposal: raw.proposal,
      shouldTrade,
      reasoning: raw.reasoning ?? 'No reasoning provided',
      confidence,
      expectedValue,
    };
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function toNumber(v: any, def: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : def;
}
