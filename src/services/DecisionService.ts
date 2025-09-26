import { BotConfig } from '../models/Config';
import { LeagueSettings } from '../models/Team';
import { LineupDecision } from '../models/Lineup';
import { Player } from '../models/Player';
import { TradeDecision, TradeProposal, WaiverDecision } from '../models/Decision';
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
    const fallbackTeamKey = (() => {
      if (raw?.proposal?.targetTeamId) return String(raw.proposal.targetTeamId);
      if (Array.isArray(raw?.proposals)) {
        const withKey = raw.proposals.find((p: any) => p?.targetTeamId);
        if (withKey?.targetTeamId) return String(withKey.targetTeamId);
      }
      return '';
    })();
    const normalized = normalizeTradeDecisionOutput(raw, myRoster, [
      { teamKey: fallbackTeamKey, teamName: undefined, roster: theirRoster },
    ]);
    const primary = normalized.primary ?? undefined;
    const shouldTrade = Boolean(raw.shouldTrade) && meetsThreshold && confidence >= this.minConfidence && !!primary;
    return {
      proposal: primary,
      proposals: normalized.all,
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
    const normalized = normalizeTradeDecisionOutput(raw, opponents.length > 0 ? myRoster : [], opponents);
    const primary = normalized.primary ?? undefined;
    const shouldTrade = Boolean(raw.shouldTrade) && meetsThreshold && confidence >= this.minConfidence && !!primary;
    return {
      proposal: primary,
      proposals: normalized.all,
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

interface TradeOpponentContext {
  teamKey: string;
  teamName?: string;
  roster: Player[];
}

interface NormalizedTradeOutput {
  primary?: TradeProposal;
  all?: TradeProposal[];
}

function normalizeTradeDecisionOutput(
  raw: any,
  myRoster: Player[],
  opponents: TradeOpponentContext[],
): NormalizedTradeOutput {
  const proposals: TradeProposal[] = [];
  const seen = new Set<string>();
  const myResolver = buildPlayerResolver(myRoster);

  const uniquePush = (proposal: TradeProposal | null) => {
    if (!proposal) return;
    const key = JSON.stringify({
      mine: [...proposal.myPlayers].sort(),
      theirs: [...proposal.theirPlayers].sort(),
      target: proposal.targetTeamId,
    });
    if (seen.has(key)) return;
    seen.add(key);
    proposals.push(proposal);
  };

  const applyCandidate = (candidate: any) => {
    if (!candidate) return;
    uniquePush(normalizeTradeProposal(candidate, myResolver, opponents));
  };

  applyCandidate(raw?.proposal);
  if (Array.isArray(raw?.proposals)) {
    for (const candidate of raw.proposals) applyCandidate(candidate);
  }

  if (proposals.length === 0) return { primary: undefined, all: undefined };
  return { primary: proposals[0], all: proposals };
}

function normalizeTradeProposal(
  candidate: any,
  myResolver: (token: string) => string | null,
  opponents: TradeOpponentContext[],
): TradeProposal | null {
  if (!candidate) return null;
  const targetTeamId = normalizeTargetTeamId(candidate.targetTeamId, opponents);
  if (!targetTeamId) return null;
  const opponent = opponents.find((o) => teamKeysEquivalent(o.teamKey, targetTeamId)) ?? null;
  const theirResolver = buildPlayerResolver(opponent?.roster ?? []);

  const resolveList = (
    values: unknown,
    resolver: (token: string) => string | null,
  ): { resolved: string[]; unresolved: string[] } => {
    const resolved: string[] = [];
    const unresolved: string[] = [];
    if (!Array.isArray(values)) return { resolved, unresolved };
    for (const entry of values) {
      const id = resolver(String(entry ?? ''));
      if (id) resolved.push(id);
      else unresolved.push(String(entry ?? ''));
    }
    return { resolved, unresolved };
  };

  const mine = resolveList(candidate.myPlayers, myResolver);
  const theirs = resolveList(candidate.theirPlayers, theirResolver);

  const hasValidSides = mine.resolved.length > 0 && theirs.resolved.length > 0;
  const unresolved = mine.unresolved.length > 0 || theirs.unresolved.length > 0;
  if (!hasValidSides || unresolved) return null;

  return {
    myPlayers: mine.resolved,
    theirPlayers: theirs.resolved,
    targetTeamId,
    reasoning: String(candidate.reasoning ?? ''),
  };
}

function normalizeTargetTeamId(raw: any, opponents: TradeOpponentContext[]): string | null {
  const input = String(raw ?? '').trim();
  if (!input) return opponents.length === 1 ? opponents[0]?.teamKey ?? null : null;

  for (const opp of opponents) {
    if (!opp?.teamKey) continue;
    if (teamKeysEquivalent(opp.teamKey, input)) return opp.teamKey;
    if (opp.teamName && opp.teamName.toLowerCase() === input.toLowerCase()) return opp.teamKey;
  }

  const teamDigit = extractTeamId(input);
  if (teamDigit) {
    const match = opponents.find((opp) => extractTeamId(opp.teamKey) === teamDigit);
    if (match) return match.teamKey;
  }

  if (input.includes('.t.')) return input;
  if (opponents.length === 1) return opponents[0]?.teamKey ?? null;
  return null;
}

function buildPlayerResolver(players: Player[]): (token: string) => string | null {
  const byToken = new Map<string, string>();
  const addToken = (token: string | null | undefined, id: string) => {
    const key = String(token ?? '').trim().toLowerCase();
    if (!key) return;
    if (byToken.has(key)) return;
    byToken.set(key, id);
  };

  const slug = (value: string) => value.replace(/[^a-z0-9]/gi, '').toLowerCase();

  for (const player of players) {
    const idRaw = String(player?.id ?? '').trim();
    if (!idRaw) continue;
    const idDigits = extractDigits(idRaw);
    addToken(idRaw, idRaw);
    addToken(idDigits, idRaw);
    if (idDigits) {
      addToken(`nfl.p.${idDigits}`, idRaw);
      addToken(`football.p.${idDigits}`, idRaw);
      addToken(`ffl.p.${idDigits}`, idRaw);
    }

    const name = String(player?.name ?? '').trim();
    if (name) {
      addToken(name, idRaw);
      addToken(name.toLowerCase(), idRaw);
      addToken(name.replace(/\s+/g, '').toLowerCase(), idRaw);
      addToken(slug(name), idRaw);
    }

    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const first = parts[0] ?? '';
      const second = parts[1] ?? '';
      const last = parts[parts.length - 1] ?? '';
      if (first && second) addToken(`${first} ${second}`.toLowerCase(), idRaw);
      if (first && last) addToken(`${first[0] ?? ''} ${last}`.toLowerCase(), idRaw);
      if (first && last) addToken(`${last}, ${first}`.toLowerCase(), idRaw);
    }
  }

  return (token: string) => {
    const raw = String(token ?? '').trim();
    if (!raw) return null;
    const candidates = new Set<string>();
    candidates.add(raw.toLowerCase());
    candidates.add(raw);
    const digits = extractDigits(raw);
    if (digits) candidates.add(digits);
    const collapsed = raw.replace(/\s+/g, '').toLowerCase();
    if (collapsed) candidates.add(collapsed);
    const slugged = raw.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (slugged) candidates.add(slugged);

    for (const candidate of candidates) {
      const key = candidate.toLowerCase();
      if (byToken.has(key)) return byToken.get(key) ?? null;
    }
    return null;
  };
}

function teamKeysEquivalent(a: string, b: string): boolean {
  const sa = String(a ?? '').trim();
  const sb = String(b ?? '').trim();
  if (!sa || !sb) return false;
  if (sa.toLowerCase() === sb.toLowerCase()) return true;
  const idA = extractTeamId(sa);
  const idB = extractTeamId(sb);
  return !!idA && idA === idB;
}

function extractTeamId(key: string): string | null {
  const match = key.match(/\.t\.(\d+)/i);
  if (match && match[1]) return match[1];
  const digits = key.match(/(\d+)/g);
  if (digits && digits.length > 0) {
    const last = digits[digits.length - 1];
    if (last) return last;
  }
  return null;
}

function extractDigits(value: string): string {
  const digits = value.replace(/\D+/g, '');
  return digits;
}
