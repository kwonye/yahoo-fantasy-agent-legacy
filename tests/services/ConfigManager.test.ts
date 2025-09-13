import fs from 'fs';
import os from 'os';
import path from 'path';

import { ConfigManager } from '../../src/services';


const withTempDir = (fn: (dir: string) => void) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgmgr-'));
  try {
    fn(dir);
  } finally {
    // best-effort cleanup
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
};

describe('ConfigManager', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  

  

  it('saves and loads encrypted credentials', () => {
    withTempDir((dir) => {
      const encryptionKey = 'unit-test-key-123';
      const mgr = new ConfigManager({ configDir: dir, encryptionKey });

      const geminiKey = 'gem-key-abc-123';
      mgr.saveGeminiCredentials({ apiKey: geminiKey });
      const loadedGemini = mgr.loadGeminiCredentials();
      expect(loadedGemini).not.toBeNull();
      expect(loadedGemini!.apiKey).toBe(geminiKey);

      const yahooCreds = {
        clientId: 'yid',
        clientSecret: 'ysecret',
        accessToken: 'at',
        refreshToken: 'rt',
      };
      mgr.saveYahooCredentials(yahooCreds);
      const loadedYahoo = mgr.loadYahooCredentials();
      expect(loadedYahoo).toMatchObject(yahooCreds);

      // Ensure on-disk content is encrypted (no plaintext api key)
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.enc.json'));
      expect(files.length).toBeGreaterThan(0);
      const contents = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
      expect(contents.includes(geminiKey)).toBe(false);
      expect(contents.includes(yahooCreds.clientSecret)).toBe(false);
    });
  });

  it('reads credentials from environment when requested', () => {
    process.env.YAHOO_CLIENT_ID = 'env-yid';
    process.env.YAHOO_CLIENT_SECRET = 'env-ysecret';
    process.env.GEMINI_API_KEY = 'env-gemini';

    const mgr = new ConfigManager();
    const creds = mgr.getEnvCredentials();
    expect(creds.yahoo.clientId).toBe('env-yid');
    expect(creds.yahoo.clientSecret).toBe('env-ysecret');
    expect(creds.gemini.apiKey).toBe('env-gemini');
  });

  it('throws if secure store is not configured for save/load', () => {
    const mgr = new ConfigManager({ encryptionKey: '' });
    expect(() => mgr.saveGeminiCredentials({ apiKey: 'x' })).toThrow();
    expect(() => mgr.loadGeminiCredentials()).toThrow();
  });
});

