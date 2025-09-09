import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { ConfigManager } from '../../src/services';
import { YahooOAuthClient } from '../../src/services/YahooOAuthClient';
import { YahooApiService } from '../../src/services/YahooApiService';
import { Position } from '../../src/models';

describe('YahooApiService', () => {
  let mock: MockAdapter;

  beforeEach(() => {
    mock = new MockAdapter(axios);
  });

  afterEach(() => {
    mock.restore();
  });

  const withSvc = (fn: (svc: YahooApiService) => Promise<void>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yapi-'));
    const mgr = new ConfigManager({ configDir: dir, encryptionKey: 'key' });
    process.env.YAHOO_CLIENT_ID = 'id';
    process.env.YAHOO_CLIENT_SECRET = 'secret';
    // Seed valid token far in future
    mgr.saveYahooAuthToken({ accessToken: 'tok', refreshToken: 'ref', expiresAt: new Date(Date.now() + 3_600_000) });
    const oauth = new YahooOAuthClient(mgr);
    const svc = new YahooApiService(oauth);
    return Promise.resolve(fn(svc)).finally(() => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    });
  };

  it('fetches league info', async () => withSvc(async (svc) => {
    mock.onGet(/\/league\/.+\?format=json/).reply((config) => {
      expect(config.headers?.Authorization).toBe('Bearer tok');
      return [200, { league: { id: 'l1', name: 'Test League', currentWeek: 2, season: 2024 } }];
    });
    const league = await svc.getLeague('nfl.l.123');
    expect(league.id).toBe('l1');
    expect(league.name).toBe('Test League');
  }));

  it('fetches team roster and maps players', async () => withSvc(async (svc) => {
    mock.onGet(/\/team\/.*\/roster\?format=json/).reply(200, {
      players: [
        { id: 'p1', name: 'QB One', position: 'QB', team: 'KC', projectedPoints: 20, averagePoints: 18 },
        { id: 'p2', name: 'RB Two', position: 'RB', team: 'SF', projectedPoints: 15, averagePoints: 14 },
      ],
    });
    const roster = await svc.getTeamRoster('nfl.l.123.t.1');
    expect(roster.length).toBe(2);
    const first = roster[0]!;
    expect(first.position).toBe(Position.QB);
  }));

  it('sets lineup via POST', async () => withSvc(async (svc) => {
    mock.onPost(/\/team\/.*\/lineup$/).reply((config) => {
      expect(config.headers?.Authorization).toBe('Bearer tok');
      const body = JSON.parse(config.data);
      expect(body.lineup).toBeDefined();
      return [200, { success: true }];
    });
    await svc.setLineup('nfl.l.123.t.1', { starters: {}, bench: [] });
  }));

  it('lists waiver wire players', async () => withSvc(async (svc) => {
    mock.onGet(/\/league\/.*\/players\?status=waivers&format=json/).reply(200, {
      players: [{ id: 'p3', name: 'WR Three', position: 'WR', team: 'BUF' }],
    });
    const players = await svc.getWaiverWirePlayers('nfl.l.123');
    const p0 = players[0]!;
    expect(p0.position).toBe(Position.WR);
  }));

  it('submits waiver claims', async () => withSvc(async (svc) => {
    mock.onPost(/\/league\/.*\/waivers$/).reply((config) => {
      expect(config.headers?.Authorization).toBe('Bearer tok');
      const body = JSON.parse(config.data);
      expect(body.claims.length).toBe(1);
      return [200, { success: true }];
    });
    const res = await svc.submitWaiverClaims('nfl.l.123', [
      { playerId: 'p3', priority: 1, reasoning: 'High upside' },
    ]);
    expect(res.success).toBe(true);
  }));

  it('proposes trade', async () => withSvc(async (svc) => {
    mock.onPost(/\/league\/.*\/trades$/).reply(200, { success: true, id: 'trade-1' });
    const res = await svc.proposeTrade('nfl.l.123', {
      myPlayers: ['p1'],
      theirPlayers: ['p9'],
      targetTeamId: 't2',
      reasoning: 'Mutual benefit',
    });
    expect(res.success).toBe(true);
    expect(res.id).toBe('trade-1');
  }));
});
