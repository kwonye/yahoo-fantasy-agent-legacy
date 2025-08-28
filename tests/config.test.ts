import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// import dynamically to allow env mutation
const loadConfigModule = async () => {
  vi.resetModules();
  return await import('../src/config.js');
};

describe('config secret assertions', () => {
  const orig = { ...process.env };
  beforeEach(() => {
    process.env = { ...orig };
  });
  afterEach(() => {
    process.env = orig;
  });

  it('assertYahooSecrets throws when Yahoo env missing', async () => {
    delete process.env.YAHOO_CLIENT_ID;
    delete process.env.YAHOO_CLIENT_SECRET;
    delete process.env.YAHOO_REDIRECT_URI;
    const { assertYahooSecrets } = await loadConfigModule();
    expect(() => assertYahooSecrets()).toThrow(/Missing required env vars/);
  });

  it('assertYahooSecrets passes when Yahoo env present', async () => {
    process.env.YAHOO_CLIENT_ID = 'id';
    process.env.YAHOO_CLIENT_SECRET = 'secret';
    process.env.YAHOO_REDIRECT_URI = 'http://localhost:3000/auth/callback';
    const { assertYahooSecrets } = await loadConfigModule();
    expect(() => assertYahooSecrets()).not.toThrow();
  });

  it('assertGeminiSecret throws when GEMINI_API_KEY missing', async () => {
    delete process.env.GEMINI_API_KEY;
    const { assertGeminiSecret } = await loadConfigModule();
    expect(() => assertGeminiSecret()).toThrow(/GEMINI_API_KEY/);
  });

  it('assertGeminiSecret passes when GEMINI_API_KEY present', async () => {
    process.env.GEMINI_API_KEY = 'key';
    const { assertGeminiSecret } = await loadConfigModule();
    expect(() => assertGeminiSecret()).not.toThrow();
  });
});
