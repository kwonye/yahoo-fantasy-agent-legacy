import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let lastPrompt = '';
let nextResponse = '{"picks":[{"player_id":"1","reason":"best value"}],"rationale":"ok"}';

vi.mock('../src/clients/gemini.js', () => {
  return {
    getModel: () => ({
      generate: (p: string) => {
        lastPrompt = p;
        return Promise.resolve(nextResponse);
      },
    }),
  };
});

describe('draft strategy prompt', () => {
  beforeEach(() => {
    vi.resetModules();
    lastPrompt = '';
  });
  afterEach(() => vi.restoreAllMocks());

  it('includes leagueSettings, rosterNeeds, and available players', async () => {
    const { suggestDraftPicks } = await import('../src/strategies/draft.js');
    const available = [
      { player_id: '1', name: 'RB One', eligible_positions: ['RB'] } as any,
      { player_id: '2', name: 'WR One', eligible_positions: ['WR'] } as any,
    ];
    const leagueSettings = { rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'] };
    const out = await suggestDraftPicks(available, { leagueSettings, top: 3 });
    expect(out.picks?.[0]?.player_id).toBe('1');
    expect(lastPrompt).toContain('Context:');
    expect(lastPrompt).toContain('rosterNeeds');
    expect(lastPrompt).toContain('AvailablePlayers:');
  });
});

