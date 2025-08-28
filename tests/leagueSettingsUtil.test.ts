import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sampleSettingsRaw = {
  fantasy_content: {
    league: {
      name: 'My League',
      season: '2025',
      settings: {
        roster_positions: {
          roster_position: [
            { position: 'QB', count: 1 },
            { position: 'RB', count: 2 },
            { position: 'WR', count: 2 },
            { position: 'TE', count: 1 },
          ],
        },
        waivers_type: 'faab',
        faab: 200,
        stat_categories: { stats: { stat: [{ stat_id: 10, display_name: 'Receptions' }] } },
        stat_modifiers: { stats: { stat: [{ stat_id: 10, value: 0.5 }] } },
      },
    },
  },
};

describe('getEffectiveLeagueSettings', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...origEnv, YAHOO_LEAGUE_KEY: 'nfl.l.12345' };
  });

  afterEach(() => {
    process.env = origEnv;
    vi.restoreAllMocks();
  });

  it('merges local overrides over normalized Yahoo settings', async () => {
    // Mock Yahoo client
    vi.doMock('../src/clients/yahooFantasy.js', () => ({
      getLeagueSettings: vi.fn().mockResolvedValue(sampleSettingsRaw),
    }));

    // Mock fs module before importing util
    vi.doMock('fs', () => {
      const api = {
        readFileSync: vi.fn().mockReturnValue(
          JSON.stringify({
            league: {
              faabBudget: 300,
              scoring: { Receptions: 0.75 },
              flexSlots: ['RB/WR'],
            },
          })
        ),
        existsSync: vi.fn().mockReturnValue(true),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
      };
      return { default: api, ...api } as any;
    });

    const { getEffectiveLeagueSettings } = await import('../src/util/leagueSettings.js');
    const bundle = await getEffectiveLeagueSettings();

    expect(bundle.yahooNormalized?.faabBudget).toBe(200);
    expect(bundle.overrides?.faabBudget).toBe(300);
    expect(bundle.effective.faabBudget).toBe(300);
    expect(bundle.yahooNormalized?.scoring?.['Receptions']).toBe(0.5);
    expect(bundle.effective.scoring?.['Receptions']).toBe(0.75);
    expect(bundle.effective.flexSlots).toContain('RB/WR');
  });
});
