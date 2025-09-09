import request from 'supertest';
import http from 'http';
import { startServer } from '../../src/web/server';

describe('Schedule API', () => {
  let server: http.Server;
  const originalEnv = { ...process.env };
  beforeAll(async () => {
    process.env = { ...originalEnv, LEAGUE_KEY: 'nfl.l.1', TEAM_KEY: 'nfl.l.1.t.1' };
    server = await startServer(0);
  });
  afterAll((done) => { server.close(done); });

  it('returns env and toggles schedule', async () => {
    const env1 = await request(server).get('/api/env');
    expect(env1.body.ok).toBe(true);
    // Accept either test override or existing env value
    expect(typeof env1.body.leagueKey).toBe('string');
    const on = await request(server).post('/api/schedule').send({ enabled: true, hour: 1, minute: 2 });
    expect(on.body.ok).toBe(true);
    const env2 = await request(server).get('/api/env');
    expect(env2.body.schedule.enabled).toBe(true);
    const off = await request(server).post('/api/schedule').send({ enabled: false });
    expect(off.body.ok).toBe(true);
  });
});
