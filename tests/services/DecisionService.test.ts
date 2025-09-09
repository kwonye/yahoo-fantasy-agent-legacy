import { DecisionService } from '../../src/services/DecisionService';
import { GeminiClient } from '../../src/services/GeminiClient';
import { RiskLevel } from '../../src/models';

class FakeGemini extends GeminiClient {
  private responses: Record<string, any>;
  constructor(responses: Record<string, any>) {
    // @ts-ignore bypass constructor apiKey requirement in tests
    super({ apiKey: 'key', baseUrl: 'http://test', model: 'm' });
    this.responses = responses;
  }
  // override
  override async optimizeLineup(): Promise<any> { return this.responses.optimizeLineup; }
  override async evaluateWaiver(): Promise<any> { return this.responses.evaluateWaiver; }
  override async evaluateTrade(): Promise<any> { return this.responses.evaluateTrade; }
}

const baseConfig = {
  riskTolerance: RiskLevel.MODERATE,
  positionPriorities: { QB: 3 },
  tradingEnabled: true,
  waiverWireEnabled: true,
  maxWaiverClaims: 2,
  tradeThreshold: 1,
  applyChanges: false,
};

describe('DecisionService', () => {
  it('returns validated lineup decision', async () => {
    const gem = new FakeGemini({
      optimizeLineup: {
        recommendedLineup: { starters: {}, bench: [] },
        changes: [],
        confidence: 0.9,
        reasoning: 'OK',
        projectedPoints: 123,
      },
    });
    const svc = new DecisionService(gem as unknown as GeminiClient, baseConfig);
    const res = await svc.decideLineup([], { rosterPositions: {}, waiverType: 'FAAB', tradeDeadline: new Date(), playoffWeeks: [], scoringType: 'h2h' }, { week: 1, season: 2024, leagueSettings: {} as any });
    expect(res.projectedPoints).toBe(123);
    expect(res.confidence).toBeCloseTo(0.9);
  });

  it('limits and sorts waiver claims by priority and respects disable flag', async () => {
    const gem = new FakeGemini({
      evaluateWaiver: {
        claims: [
          { playerId: 'p1', priority: 3, reasoning: 'ok' },
          { playerId: 'p2', priority: 1, reasoning: 'best' },
          { playerId: 'p3', priority: 2, reasoning: 'good' },
        ],
        reasoning: 'Do it',
        confidence: 0.7,
        expectedValue: 5,
      },
    });
    const svc = new DecisionService(gem as unknown as GeminiClient, { ...baseConfig, maxWaiverClaims: 2 });
    const res = await svc.decideWaivers([], { week: 1, season: 2024, leagueSettings: {} as any });
    expect(res.claims.length).toBe(2);
    const first = res.claims[0]!;
    expect(first.playerId).toBe('p2'); // priority 1 first

    const svc2 = new DecisionService(gem as unknown as GeminiClient, { ...baseConfig, waiverWireEnabled: false });
    const res2 = await svc2.decideWaivers([], { week: 1, season: 2024, leagueSettings: {} as any });
    expect(res2.claims.length).toBe(0);
  });

  it('gates trades on config flags, confidence, and threshold', async () => {
    const gem = new FakeGemini({
      evaluateTrade: { shouldTrade: true, reasoning: 'Great', confidence: 0.6, expectedValue: 2, proposal: { myPlayers: ['a'], theirPlayers: ['b'], targetTeamId: 't', reasoning: 'mutual' } },
    });
    const svc = new DecisionService(gem as unknown as GeminiClient, baseConfig, { minConfidence: 0.5 });
    const ok = await svc.decideTrade([], [], { week: 1, season: 2024, leagueSettings: {} as any });
    expect(ok.shouldTrade).toBe(true);

    const svcLowConf = new DecisionService(gem as unknown as GeminiClient, baseConfig, { minConfidence: 0.8 });
    const low = await svcLowConf.decideTrade([], [], { week: 1, season: 2024, leagueSettings: {} as any });
    expect(low.shouldTrade).toBe(false);

    const svcThresh = new DecisionService(gem as unknown as GeminiClient, { ...baseConfig, tradeThreshold: 3 });
    const below = await svcThresh.decideTrade([], [], { week: 1, season: 2024, leagueSettings: {} as any });
    expect(below.shouldTrade).toBe(false);

    const svcDisabled = new DecisionService(gem as unknown as GeminiClient, { ...baseConfig, tradingEnabled: false });
    const noTrade = await svcDisabled.decideTrade([], [], { week: 1, season: 2024, leagueSettings: {} as any });
    expect(noTrade.shouldTrade).toBe(false);
  });
});
