import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// import dynamically to allow env mutation
const loadConfigModule = async () => await import('../src/config.js');

describe('config assertSecrets', () => {
  const orig = { ...process.env };
  beforeEach(() => {
    process.env = { ...orig };
  });
  afterEach(() => {
    process.env = orig;
  });

  it('throws when required env missing', async () => {
    delete process.env.YAHOO_CLIENT_ID;
    delete process.env.YAHOO_CLIENT_SECRET;
    delete process.env.YAHOO_REDIRECT_URI;
    delete process.env.GEMINI_API_KEY;
    const { assertSecrets } = await loadConfigModule();
    expect(() => assertSecrets()).toThrow(/Missing required env vars/);
  });

  it('passes when required env are present', async () => {
    process.env.YAHOO_CLIENT_ID = 'id';
    process.env.YAHOO_CLIENT_SECRET = 'secret';
    process.env.YAHOO_REDIRECT_URI = 'http://localhost:3000/auth/callback';
    process.env.GEMINI_API_KEY = 'key';
    const { assertSecrets } = await loadConfigModule();
    expect(() => assertSecrets()).not.toThrow();
  });
});

