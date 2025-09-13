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
  private readonly minConfidence: number;

  constructor(gemini: GeminiClient, opts: DecisionServiceOptions = {}) {
    this.gemini = gemini;
    
    this.minConfidence = opts.minConfidence ?? 0.5;
  }

  async decideLineup(
    roster: Player[],
    leagueSettings: LeagueSettings,
    context: Omit<AnalysisContext, 'userPreferences'>
  ): Promise<LineupDecision> {
    const raw = await this.gemini.optimizeLineup(roster, leagueSettings, { applyChanges: true }, context);
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
    
    const raw = await this.gemini.evaluateWaiver(
      availablePlayers,
      { applyChanges: true },
      100,
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
        const cap = Math.max(0, Math.min(100, Number(maxWeek)));
        claims = claims.slice(0, cap);
      }
    } catch {}

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
      .slice(0, Math.max(0, 100));

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

    const raw = await this.gemini.evaluateTrade(myRoster, theirRoster, { applyChanges: true }, context);
    const confidence = clamp(raw.confidence ?? 0, 0, 1);
    const expectedValue = toNumber(raw.expectedValue, 0);

    // Apply trade threshold gating
    const meetsThreshold = true;
    const shouldTrade = Boolean(raw.shouldTrade) && meetsThreshold && confidence >= this.minConfidence;

    const primary = raw.proposal ?? (Array.isArray((raw as any).proposals) ? (raw as any).proposals[0] : undefined);
    return {
      proposal: primary,
      proposals: (raw as any).proposals,
      shouldTrade,
      reasoning: raw.reasoning ?? 'No reasoning provided',
      confidence,
      expectedValue,
    };
  }

  async decideTradeMulti(
    myRoster: Player[],
    opponents: Array<{ teamKey: string; teamName?: string; roster: Player[] }>,
    context: Omit<AnalysisContext, 'userPreferences'>
  ): Promise<TradeDecision> {

    const raw = await this.gemini.evaluateTradesMulti(myRoster, opponents, { applyChanges: true }, context);
    const confidence = clamp(raw.confidence ?? 0, 0, 1);
    const expectedValue = toNumber(raw.expectedValue, 0);
    const meetsThreshold = true;
    const primary = raw.proposal ?? (Array.isArray((raw as any).proposals) ? (raw as any).proposals[0] : undefined);
    const shouldTrade = Boolean(raw.shouldTrade) && meetsThreshold && confidence >= this.minConfidence && !!primary;
    return {
      proposal: primary,
      proposals: (raw as any).proposals,
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
