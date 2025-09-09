import axios, { AxiosInstance } from 'axios';
import { URLSearchParams } from 'url';
import { ConfigManager } from './ConfigManager';
import { AuthToken, YahooCredentials } from '../models';

export interface YahooOAuthOptions {
  authBaseUrl?: string; // request_auth
  tokenUrl?: string; // get_token
}

export class YahooOAuthClient {
  private readonly tokenUrl: string;
  private readonly authBaseUrl: string;
  private readonly http: AxiosInstance;
  private readonly config: ConfigManager;

  constructor(config: ConfigManager, opts: YahooOAuthOptions = {}) {
    this.config = config;
    this.tokenUrl = opts.tokenUrl ?? 'https://api.login.yahoo.com/oauth2/get_token';
    this.authBaseUrl = opts.authBaseUrl ?? 'https://api.login.yahoo.com/oauth2/request_auth';
    this.http = axios.create();
  }

  getAuthorizationUrl(redirectUri: string, state: string, scope = (process.env.YAHOO_SCOPE || 'fspt-w')): string {
    const creds = this.getCreds();
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      language: 'en-us',
      state,
      scope,
    });
    return `${this.authBaseUrl}?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string, redirectUri: string): Promise<AuthToken> {
    const creds = this.getCreds();
    const params = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: 'authorization_code',
    });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    let data: any;
    try {
      const resp = await this.http.post(this.tokenUrl, params.toString(), { headers });
      data = resp.data;
    } catch (e: any) {
      const status = e?.response?.status;
      const body = e?.response?.data;
      const msg = status ? `status ${status}` : (e?.message || 'request failed');
      if (process.env.DEBUG_OAUTH === '1') {
        try { console.warn('[OAuth] Token exchange error:', msg, '\nBody:', typeof body === 'object' ? JSON.stringify(body) : String(body)); } catch {}
      }
      throw new Error(msg + (body ? `; body=${typeof body === 'object' ? JSON.stringify(body) : String(body)}` : ''));
    }
    const token = this.mapTokenResponse(data);
    this.config.saveYahooAuthToken(token);
    // Persist tokens alongside client credentials, but keep user-saved clientId/secret if present in store
    try {
      const existing = this.config.loadYahooCredentials();
      const base = (existing && existing.clientId && existing.clientSecret) ? existing : creds;
      this.config.saveYahooCredentials({ ...base, accessToken: token.accessToken, refreshToken: token.refreshToken });
    } catch {
      // ignore if secure store not configured
    }
    return token;
  }

  async getValidAccessToken(): Promise<string> {
    let token = this.config.loadYahooAuthToken();
    if (token && token.expiresAt.getTime() - Date.now() > 60_000) {
      return token.accessToken;
    }
    // Try refresh using stored refresh token or creds
    const creds = this.getCreds();
    const refreshToken = token?.refreshToken ?? creds.refreshToken;
    if (!refreshToken) {
      throw new Error('No refresh token available. Complete OAuth flow.');
    }
    token = await this.refreshAccessToken(refreshToken);
    return token.accessToken;
  }

  async refreshAccessToken(refreshToken: string): Promise<AuthToken> {
    const creds = this.getCreds();
    const params = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    let data: any;
    try {
      const resp = await this.http.post(this.tokenUrl, params.toString(), { headers });
      data = resp.data;
    } catch (e: any) {
      const status = e?.response?.status;
      const body = e?.response?.data;
      const msg = status ? `status ${status}` : (e?.message || 'request failed');
      if (process.env.DEBUG_OAUTH === '1') {
        try { console.warn('[OAuth] Refresh error:', msg, '\nBody:', typeof body === 'object' ? JSON.stringify(body) : String(body)); } catch {}
      }
      throw new Error(msg + (body ? `; body=${typeof body === 'object' ? JSON.stringify(body) : String(body)}` : ''));
    }
    const token = this.mapTokenResponse(data, refreshToken);
    this.config.saveYahooAuthToken(token);
    // Keep creds in sync but preserve any store clientId/secret if available
    try {
      const existing = this.config.loadYahooCredentials();
      const base = (existing && existing.clientId && existing.clientSecret) ? existing : creds;
      this.config.saveYahooCredentials({ ...base, accessToken: token.accessToken, refreshToken: token.refreshToken });
    } catch {}
    return token;
  }

  private mapTokenResponse(data: any, fallbackRefreshToken?: string): AuthToken {
    const accessToken: string = data.access_token;
    const refreshToken: string = data.refresh_token ?? fallbackRefreshToken ?? '';
    const expiresIn: number = typeof data.expires_in === 'string' ? parseInt(data.expires_in, 10) : data.expires_in;
    const expiresAt = new Date(Date.now() + (Number.isFinite(expiresIn) ? expiresIn * 1000 : 3600_000));
    if (!accessToken) throw new Error('Invalid token response: missing access_token');
    if (!refreshToken) throw new Error('Invalid token response: missing refresh_token');
    return { accessToken, refreshToken, expiresAt };
  }

  private getCreds(): YahooCredentials {
    // Only use credentials from secure store (set via dashboard)
    const loadStore = (): YahooCredentials | null => {
      try { return this.config.loadYahooCredentials(); } catch { return null; }
    };
    const fromStore = loadStore();

    if (fromStore?.clientId && fromStore?.clientSecret) return fromStore;

    throw new Error('Yahoo client credentials are not configured');
  }
}
