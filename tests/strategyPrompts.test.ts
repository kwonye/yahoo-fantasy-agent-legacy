import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let lastPrompt = '';
let nextResponse = '{"moves":[],"rationale":"ok"}';

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

describe('strategy prompts include leagueSettings and manager context', () => {
  beforeEach(() => {
    vi.resetModules();
    lastPrompt = '';
    nextResponse = '{"moves":[],"rationale":"ok"}';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('decideLineup includes leagueSettings and context', async () => {
    const { decideLineup } = await import('../src/strategies/lineup.js');
    const leagueSettings = { rosterPositions: ['QB', 'RB'], scoring: { Receptions: 1 } };
    await decideLineup(
      [{ player_id: '1', name: 'A', eligible_positions: ['QB'] } as any],
      { opponent: 'X' },
      leagueSettings,
    );
    expect(lastPrompt).toContain('Context:');
    expect(lastPrompt).toContain('leagueSettings');
    expect(lastPrompt).toContain('rosterPositions');
    expect(lastPrompt).toContain('Roster:');
    expect(lastPrompt).toContain('Matchup:');
  });

  it('decideWaiverAction includes leagueSettings and manager FAAB', async () => {
    const { decideWaiverAction } = await import('../src/strategies/waivers.js');
    nextResponse = 'null';
    const leagueSettings = { waiverType: 'FAAB', faabBudget: 200 };
    await decideWaiverAction(
      [{ player_id: '2', name: 'FA', eligible_positions: ['RB'] } as any],
      [{ player_id: '3', name: 'My RB', eligible_positions: ['RB'] } as any],
      leagueSettings,
    );
    expect(lastPrompt).toContain('Context:');
    expect(lastPrompt).toContain('leagueSettings');
    // manager context includes faabBudget; ensure present
    expect(lastPrompt).toMatch(/faabBudget/);
    expect(lastPrompt).toContain('FreeAgents:');
    expect(lastPrompt).toContain('Roster:');
  });

  it('proposeTradeFromContext includes leagueSettings block', async () => {
    const { proposeTradeFromContext } = await import('../src/strategies/trades.js');
    nextResponse = 'null';
    const leagueSettings = { scoring: { 'Passing TD': 4 } };
    await proposeTradeFromContext(
      [{ player_id: '4', name: 'QB', eligible_positions: ['QB'] } as any],
      [{ team_key: 'nfl.l.x.t.2', roster: [{ player_id: '5', name: 'WR', eligible_positions: ['WR'] } as any] }],
      leagueSettings,
    );
    expect(lastPrompt).toContain('LeagueSettings:');
    expect(lastPrompt).toContain('scoring');
    expect(lastPrompt).toContain('MyRoster:');
    expect(lastPrompt).toContain('OtherTeams:');
  });
});

