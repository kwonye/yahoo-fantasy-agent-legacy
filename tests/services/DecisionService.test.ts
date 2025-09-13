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
    const svc = new DecisionService(gem as unknown as GeminiClient);
    const res = await svc.decideLineup([], { rosterPositions: {}, waiverType: 'FAAB', tradeDeadline: new Date(), playoffWeeks: [], scoringType: 'h2h' }, { week: 1, season: 2024, leagueSettings: {} as any });
    expect(res.projectedPoints).toBe(123);
    expect(res.confidence).toBeCloseTo(0.9);
  });

  it('limits and sorts waiver claims by priority', async () => {
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
    const svc = new DecisionService(gem as unknown as GeminiClient);
    const res = await svc.decideWaivers([], { week: 1, season: 2024, leagueSettings: {} as any });
    expect(res.claims.length).toBe(3);
    const first = res.claims[0]!;
    expect(first.playerId).toBe('p2'); // priority 1 first
  });

  it('gates trades on confidence threshold', async () => {
    const gem = new FakeGemini({
      evaluateTrade: { shouldTrade: true, reasoning: 'Great', confidence: 0.6, expectedValue: 2, proposal: { myPlayers: ['a'], theirPlayers: ['b'], targetTeamId: 't', reasoning: 'mutual' } },
    });
    const svc = new DecisionService(gem as unknown as GeminiClient, { minConfidence: 0.5 });
    const ok = await svc.decideTrade([], [], { week: 1, season: 2024, leagueSettings: {} as any });
    expect(ok.shouldTrade).toBe(true);

    const svcLowConf = new DecisionService(gem as unknown as GeminiClient, { minConfidence: 0.8 });
    const low = await svcLowConf.decideTrade([], [], { week: 1, season: 2024, leagueSettings: {} as any });
    expect(low.shouldTrade).toBe(false);
  });
});
