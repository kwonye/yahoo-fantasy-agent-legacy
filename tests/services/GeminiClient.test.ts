import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { GeminiClient } from '../../src/services/GeminiClient';
import { RiskLevel } from '../../src/models';

describe('GeminiClient', () => {
  let mock: MockAdapter;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, GEMINI_API_KEY: 'key', GEMINI_MODEL: 'gemini-2.5-flash' };
    mock = new MockAdapter(axios);
  });

  afterEach(() => {
    mock.restore();
  });

  const mockText = (text: string) => ({
    candidates: [
      {
        content: { parts: [{ text }] },
      },
    ],
  });

  it('optimizes lineup and parses JSON', async () => {
    const client = new GeminiClient();
    mock.onPost(/generateContent\?key=/).reply(200, mockText(
      JSON.stringify({
        recommendedLineup: { starters: {}, bench: [] },
        changes: [],
        confidence: 0.9,
        reasoning: 'Looks good',
        projectedPoints: 100,
      })
    ));
    const decision = await client.optimizeLineup(
      [],
      { rosterPositions: {}, waiverType: 'FAAB', tradeDeadline: new Date(), playoffWeeks: [], scoringType: 'h2h' },
      { applyChanges: false },
      { week: 1, season: 2024, leagueSettings: {} as any }
    );
    expect(decision.confidence).toBeCloseTo(0.9);
  });

  it('evaluates waiver and parses JSON', async () => {
    const client = new GeminiClient();
    mock.onPost(/generateContent\?key=/).reply(200, mockText(
      JSON.stringify({
        claims: [{ playerId: 'p1', priority: 1, reasoning: 'High upside' }],
        reasoning: 'Target RB depth',
        confidence: 0.8,
        expectedValue: 5.5,
      })
    ));
    const res = await client.evaluateWaiver([], {
      applyChanges: false,
    }, 2, { week: 1, season: 2024, leagueSettings: {} as any });
    expect(res.claims.length).toBe(1);
  });

  it('evaluates trade and parses JSON', async () => {
    const client = new GeminiClient();
    mock.onPost(/generateContent\?key=/).reply(200, mockText(
      JSON.stringify({ shouldTrade: false, reasoning: 'Not favorable', confidence: 0.7, expectedValue: -2 })
    ));
    const res = await client.evaluateTrade([], [], {
      applyChanges: false,
    }, { week: 1, season: 2024, leagueSettings: {} as any });
    expect(res.shouldTrade).toBe(false);
  });
});
