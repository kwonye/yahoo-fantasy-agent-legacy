import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('exchangeEnvAuthCodeIfPresent', () => {
  const orig = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...orig, YAHOO_CLIENT_ID: 'id', YAHOO_CLIENT_SECRET: 'secret', YAHOO_AUTH_CODE: 'code123' };
  });

  afterEach(() => {
    process.env = orig;
    vi.restoreAllMocks();
  });

  it('exchanges code with Basic auth and saves tokens', async () => {
    // Mock axios
    vi.doMock('axios', () => ({
      default: {
        post: vi.fn().mockResolvedValue({ data: { access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 3600 } }),
      },
    }));
    // Spy on saveTokens
    const tokenStore = await import('../src/store/tokenStore.js');
    const saveSpy = vi.spyOn(tokenStore, 'saveTokens').mockImplementation(() => ({} as any));

    const { exchangeEnvAuthCodeIfPresent } = await import('../src/clients/yahooAuth.js');
    const used = await exchangeEnvAuthCodeIfPresent();
    expect(used).toBe(true);
    expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({ access_token: 'a', refresh_token: 'r' }));
  });

  it('no-op when env code not present', async () => {
    delete process.env.YAHOO_AUTH_CODE;
    const { exchangeEnvAuthCodeIfPresent } = await import('../src/clients/yahooAuth.js');
    const used = await exchangeEnvAuthCodeIfPresent();
    expect(used).toBe(false);
  });
});
