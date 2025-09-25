import request from 'supertest';
import fs from 'fs';
import type { Express } from 'express';

const defaultSettings = { leagueKey: 'nfl.l.123', teamKey: 'nfl.l.123.t.1' };
const loadAppSettingsMock = jest.fn(() => ({ ...defaultSettings }));
const getPendingTradesMock = jest.fn();

jest.mock('../../src/services/ConfigManager', () => ({
  ConfigManager: jest.fn().mockImplementation(() => ({
    loadAppSettings: loadAppSettingsMock,
    saveAppSettings: jest.fn(),
    loadLeagueProfile: jest.fn(),
    loadYahooCredentials: jest.fn(),
  })),
}));

jest.mock('../../src/services/YahooOAuthClient', () => ({
  YahooOAuthClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../src/services/YahooApiService', () => ({
  YahooApiService: jest.fn().mockImplementation(() => ({
    getPendingTrades: getPendingTradesMock,
  })),
}));

const { app }: { app: Express } = require('../../src/web/server');

describe('GET /api/trades/incoming filtering', () => {
  let appendSpy: jest.SpyInstance;
  let existsSpy: jest.SpyInstance;

  beforeAll(() => {
    appendSpy = jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
    existsSpy = jest.spyOn(fs, 'existsSync').mockImplementation(() => true);
  });

  afterAll(() => {
    appendSpy.mockRestore();
    existsSpy.mockRestore();
  });

  beforeEach(() => {
    getPendingTradesMock.mockReset();
    loadAppSettingsMock.mockReset();
    loadAppSettingsMock.mockImplementation(() => ({ ...defaultSettings }));
  });

  it('filters to pending proposals that include my team in trade moves', async () => {
    const myTeamKey = defaultSettings.teamKey;
    const otherTeamKey = 'nfl.l.123.t.2';
    const trades = [
      {
        id: 'keep',
        status: 'proposed',
        moves: [{ source: myTeamKey, destination: otherTeamKey }],
      },
      {
        id: 'drop-no-moves',
        status: 'proposed',
        teamKeys: [myTeamKey, otherTeamKey],
        moves: [{ source: otherTeamKey, destination: 'nfl.l.123.t.3' }],
      },
      {
        id: 'drop-success',
        status: 'successful',
        moves: [{ source: otherTeamKey, destination: myTeamKey }],
      },
      {
        id: 'drop-raw-success',
        status: 'pending',
        raw: { status: 'Successful' },
        moves: [{ source: myTeamKey, destination: otherTeamKey }],
      },
    ];
    getPendingTradesMock.mockResolvedValue(trades);

    const res = await request(app).get('/api/trades/incoming');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(getPendingTradesMock).toHaveBeenCalledWith(defaultSettings.leagueKey, defaultSettings.teamKey, expect.any(Object));
    const returnedIds = Array.isArray(res.body.trades) ? res.body.trades.map((t: any) => t.id) : [];
    expect(returnedIds).toEqual(['keep']);
  });
});

