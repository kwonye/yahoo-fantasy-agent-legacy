import fs from 'fs';
import path from 'path';
import os from 'os';
import { BotController } from '../../src/controllers/BotController';

// We will mock underlying services by environment stubs and replacing methods on instance after construction

describe('BotController', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, GEMINI_API_KEY: 'key', YAHOO_CLIENT_ID: 'id', YAHOO_CLIENT_SECRET: 'secret', CONFIG_ENCRYPTION_KEY: 'test-key' };
  });

  it('runs daily and records decisions with mocks', async () => {
    const bc = new BotController({ leagueKey: 'nfl.l.1', teamKey: 'nfl.l.1.t.1' });
    // Monkey-patch services inside controller for isolation
    // @ts-ignore access private for test
    bc['yahoo'].getLeague = jest.fn().mockResolvedValue({
      id: 'nfl.l.1', name: 'Test', season: 2024, currentWeek: 1,
      settings: { rosterPositions: {}, waiverType: 'FAAB', tradeDeadline: new Date(), playoffWeeks: [], scoringType: 'h2h' },
      teams: [],
    });
    // @ts-ignore
    bc['yahoo'].getTeamRoster = jest.fn().mockResolvedValue([{ player: { id: 'p1', name: 'My Player' } }]);
    // @ts-ignore
    bc['yahoo'].getTeamRosterWithSlots = jest.fn().mockImplementation((teamKey) => {
      if (teamKey.endsWith('t.1')) return Promise.resolve([{ player: { id: 'p1', name: 'My Player' } }]);
      return Promise.resolve([{ player: { id: 'p2', name: 'Their Player' } }]);
    });
    // @ts-ignore
    bc['yahoo'].getWaiverWirePlayers = jest.fn().mockResolvedValue([]);
    // @ts-ignore
    bc['yahoo'].setLineup = jest.fn().mockResolvedValue(undefined);
    // @ts-ignore
    bc['yahoo'].submitWaiverClaims = jest.fn().mockResolvedValue({ success: true });
    // @ts-ignore
    bc['yahoo'].proposeTrade = jest.fn().mockResolvedValue({ success: true, id: 'trade-1' });
    // @ts-ignore
    bc['yahoo'].getPendingTrades = jest.fn().mockResolvedValue([]);
    // @ts-ignore
    bc['yahoo'].getLeagueTeams = jest.fn().mockResolvedValue([{ key: 'nfl.l.1.t.2', name: 'Opponent' }]);
    // @ts-ignore
    bc['yahoo'].getAllTransactionsNormalized = jest.fn().mockResolvedValue([]);
    // @ts-ignore
    bc['yahoo'].getTeamInfo = jest.fn().mockResolvedValue({ id: 'nfl.l.1.t.1', faabBalance: 100 });

    // @ts-ignore
    bc['decisions'] = {
      decideLineup: jest.fn().mockResolvedValue({
        recommendedLineup: { starters: {}, bench: [] }, changes: [], confidence: 0.9, reasoning: 'OK', projectedPoints: 100,
      }),
      decideWaivers: jest.fn().mockResolvedValue({ claims: [], reasoning: 'none', confidence: 1, expectedValue: 0 }),
      decideTradeMulti: jest.fn().mockResolvedValue({
        shouldTrade: true,
        proposal: { myPlayers: ['p1'], theirPlayers: ['p2'], targetTeamId: 'nfl.l.1.t.2' },
        reasoning: 'test trade',
        confidence: 1,
        expectedValue: 1
      }),
    };

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
    // @ts-ignore
    bc['audit'] = new (jest.requireActual('../../src/services/AuditTrail').AuditTrail)({ dir: tmp, filename: 'a.log' });

    await bc.runDaily();

    const logPath = path.join(tmp, 'a.log');
    const content = fs.readFileSync(logPath, 'utf8');
    expect(content).toContain('decision');
  });
});

