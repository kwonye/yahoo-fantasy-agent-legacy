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

  getAuthorizationUrl(redirectUri: string, state: string, scope = 'fspt-w'): string {
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
    const { data } = await this.http.post(this.tokenUrl, params.toString(), { headers });
    const token = this.mapTokenResponse(data);
    this.config.saveYahooAuthToken(token);
    // Optionally also persist tokens in creds for compatibility
    this.config.saveYahooCredentials({ ...creds, accessToken: token.accessToken, refreshToken: token.refreshToken });
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
    const { data } = await this.http.post(this.tokenUrl, params.toString(), { headers });
    const token = this.mapTokenResponse(data, refreshToken);
    this.config.saveYahooAuthToken(token);
    // keep creds in sync for other consumers
    this.config.saveYahooCredentials({ ...creds, accessToken: token.accessToken, refreshToken: token.refreshToken });
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
    // Prefer environment overrides so updating .env takes immediate effect
    const envId = process.env.YAHOO_CLIENT_ID;
    const envSecret = process.env.YAHOO_CLIENT_SECRET;
    const envAccess = process.env.YAHOO_ACCESS_TOKEN;
    const envRefresh = process.env.YAHOO_REFRESH_TOKEN;

    if (envId && envSecret) {
      const envCreds: YahooCredentials = {
        clientId: envId,
        clientSecret: envSecret,
        accessToken: envAccess,
        refreshToken: envRefresh,
      };
      // Try to persist for consistency if secure store is available
      try {
        this.config.saveYahooCredentials(envCreds);
      } catch {
        // ignore if secure store not configured
      }
      return envCreds;
    }

    let fromStore: YahooCredentials | null = null;
    try {
      fromStore = this.config.loadYahooCredentials();
    } catch {
      // ignore when secure store is not configured
    }
    const creds = fromStore ?? { clientId: '', clientSecret: '' } as YahooCredentials;
    if (!creds.clientId || !creds.clientSecret) {
      throw new Error('Yahoo client credentials are not configured');
    }
    return creds;
  }
}
