import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { ConfigManager } from '../../src/services';
import { YahooOAuthClient } from '../../src/services/YahooOAuthClient';

describe('YahooOAuthClient', () => {
  const originalEnv = { ...process.env };
  let mock: MockAdapter;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mock = new MockAdapter(axios);
  });

  afterEach(() => {
    mock.restore();
  });

  const withMgr = (fn: (mgr: ConfigManager) => Promise<void> | void) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yahoo-'));
    const mgr = new ConfigManager({ configDir: dir, encryptionKey: 'key' });
    process.env.YAHOO_CLIENT_ID = 'id';
    process.env.YAHOO_CLIENT_SECRET = 'secret';
    return Promise.resolve(fn(mgr)).finally(() => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    });
  };

  it('builds authorization URL', () => withMgr((mgr) => {
    const client = new YahooOAuthClient(mgr);
    const url = client.getAuthorizationUrl('https://app/callback', 'xyz', 'fspt-w');
    expect(url).toContain('response_type=code');
    expect(url).toContain('client_id=id');
    expect(url).toContain('redirect_uri=');
    expect(url).toContain('state=xyz');
  }));

  it('exchanges code for token and persists', async () => withMgr(async (mgr) => {
    const client = new YahooOAuthClient(mgr);
    mock.onPost('https://api.login.yahoo.com/oauth2/get_token').reply(200, {
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'bearer',
      expires_in: 3600,
    });
    const token = await client.exchangeCodeForToken('authcode', 'https://app/callback');
    expect(token.accessToken).toBe('access');
    expect(token.refreshToken).toBe('refresh');

    // Subsequent call should return same token if still valid
    const access = await client.getValidAccessToken();
    expect(access).toBe('access');
  }));

  it('refreshes access token when expired', async () => withMgr(async (mgr) => {
    const client = new YahooOAuthClient(mgr);
    // Seed stored token with expired access token
    const past = new Date(Date.now() - 10_000);
    mgr.saveYahooAuthToken({ accessToken: 'old', refreshToken: 'r1', expiresAt: past });

    mock.onPost('https://api.login.yahoo.com/oauth2/get_token').reply(200, {
      access_token: 'newAccess',
      refresh_token: 'r1',
      expires_in: 7200,
    });
    const access = await client.getValidAccessToken();
    expect(access).toBe('newAccess');
  }));

  it('throws when no refresh token available', async () => withMgr(async (mgr) => {
    const client = new YahooOAuthClient(mgr);
    await expect(client.getValidAccessToken()).rejects.toThrow();
  }));
});

