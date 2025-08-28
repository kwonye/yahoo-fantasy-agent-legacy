import { describe, it, expect } from 'vitest';
import { normalizeLeagueSettings } from '../src/clients/yahooParsers.js';

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
            { position: 'W/R/T', count: 1 },
            { position: 'BN', count: 5 },
            { position: 'IR', count: 1 },
          ],
        },
        waivers_type: 'faab',
        faab: 200,
        trade_end_date: '2025-11-15',
        stat_categories: {
          stats: {
            stat: [
              { stat_id: 4, display_name: 'Passing Yards' },
              { stat_id: 6, display_name: 'Passing TD' },
              { stat_id: 10, display_name: 'Receptions' },
            ],
          },
        },
        stat_modifiers: {
          stats: {
            stat: [
              { stat_id: 4, value: 0.04 },
              { stat_id: 6, value: 4 },
              { stat_id: 10, value: 0.5 },
            ],
          },
        },
      },
    },
  },
};

describe('normalizeLeagueSettings', () => {
  it('produces expected normalized fields', () => {
    const n = normalizeLeagueSettings(sampleSettingsRaw as any);
    expect(n.leagueName).toBe('My League');
    expect(n.season).toBe(2025);
    expect(n.positionCounts).toMatchObject({ QB: 1, RB: 2, WR: 2, TE: 1 });
    expect(n.flexSlots).toEqual(['W/R/T']);
    expect(n.benchSpots).toBe(5);
    expect(n.irSpots).toBe(1);
    expect(n.waiverType).toBe('FAAB');
    expect(n.faabBudget).toBe(200);
    expect(n.tradeDeadlineDate).toBe('2025-11-15');
    expect(n.scoring?.['Passing Yards']).toBe(0.04);
    expect(n.scoring?.['Passing TD']).toBe(4);
    expect(n.scoring?.['Receptions']).toBe(0.5);
    // rosterPositions should include ordered starting slots (excluding BN/IR)
    expect(n.rosterPositions).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE']);
  });
});

