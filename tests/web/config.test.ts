import request from 'supertest';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startServer } from '../../src/web/server';

describe('Config and creds API', () => {
  let server: http.Server;
  const originalEnv = { ...process.env };
  let tmpDir: string;
  let prefsPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcfg-'));
    prefsPath = path.join(tmpDir, 'bot-config.json');
    process.env = { ...originalEnv, BOT_CONFIG_PATH: prefsPath, CONFIG_ENCRYPTION_KEY: 'key', CONFIG_DIR: tmpDir };
    server = await startServer(0);
  });

  afterAll((done) => {
    server.close(done);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('updates config via POST and returns overrides', async () => {
    const res1 = await request(server).post('/api/config').send({ bot: { maxWaiverClaims: 5, applyChanges: true } });
    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    const res2 = await request(server).get('/api/config');
    expect(res2.body.config.maxWaiverClaims).toBe(5);
    expect(res2.body.config.applyChanges).toBe(true);
    // file is written
    expect(fs.existsSync(prefsPath)).toBe(true);
  });

  it('saves credentials via POST and masks on GET', async () => {
    const y = await request(server).post('/api/creds/yahoo').send({ clientId: 'abc123', clientSecret: 'shhh' });
    expect(y.body.ok).toBe(true);
    const g = await request(server).post('/api/creds/gemini').send({ apiKey: 'gem-key' });
    expect(g.body.ok).toBe(true);
    const res = await request(server).get('/api/creds');
    expect(res.body.creds.yahoo.clientId).toContain('***');
    expect(res.body.creds.gemini.apiKey).toContain('***');
  });
});

