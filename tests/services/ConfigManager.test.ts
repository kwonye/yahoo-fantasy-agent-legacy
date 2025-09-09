import fs from 'fs';
import os from 'os';
import path from 'path';

import { ConfigManager } from '../../src/services';
import { RiskLevel } from '../../src/models';

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

  it('applies defaults and parses environment variables', () => {
    process.env.BOT_RISK_TOLERANCE = 'AGGRESSIVE';
    process.env.BOT_POSITION_PRIORITIES = 'QB:4,RB:5,WR:5,TE:2,K:1,DEF:1';
    process.env.BOT_TRADING_ENABLED = 'false';
    process.env.BOT_WAIVER_WIRE_ENABLED = 'true';
    process.env.BOT_MAX_WAIVER_CLAIMS = '5';
    process.env.BOT_TRADE_THRESHOLD = '1.5';

    const mgr = new ConfigManager();
    const cfg = mgr.getBotConfig();
    expect(cfg.riskTolerance).toBe(RiskLevel.AGGRESSIVE);
    expect(cfg.positionPriorities.QB).toBe(4);
    expect(cfg.tradingEnabled).toBe(false);
    expect(cfg.waiverWireEnabled).toBe(true);
    expect(cfg.maxWaiverClaims).toBe(5);
    expect(cfg.tradeThreshold).toBe(1.5);
  });

  it('validates configuration values', () => {
    process.env.BOT_RISK_TOLERANCE = 'INVALID';
    process.env.BOT_MAX_WAIVER_CLAIMS = '-1';
    const mgr = new ConfigManager();
    expect(() => mgr.getBotConfig()).toThrow();
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

