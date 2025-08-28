import axios from 'axios';
import qs from 'qs';
import { config } from '../config.js';
import { saveTokens, loadTokens, TokenBundle } from '../store/tokenStore.js';
import { logger } from '../logger.js';

const OAUTH_BASE = 'https://api.login.yahoo.com';
let envAuthUsedThisRun = false;

export function getAuthUrl(state = 'state123') {
  const params = new URLSearchParams({
    client_id: config.yahooClientId,
    redirect_uri: config.yahooRedirectUri,
    response_type: 'code',
    language: 'en-us',
    scope: config.yahooScope,
    state,
  });
  return `${OAUTH_BASE}/oauth2/request_auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenBundle> {
  const body = qs.stringify({
    client_id: config.yahooClientId,
    client_secret: config.yahooClientSecret,
    redirect_uri: config.yahooRedirectUri,
    code,
    grant_type: 'authorization_code',
  });
  const { data } = await axios.post(`${OAUTH_BASE}/oauth2/get_token`, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  saveTokens(data);
  return loadTokens()!;
}

export async function refreshTokensIfNeeded(): Promise<TokenBundle | null> {
  const tokens = loadTokens();
  if (!tokens) return null;
  const expiresAt = tokens.obtained_at + tokens.expires_in - 60; // refresh 1m early
  if (Date.now() / 1000 < expiresAt) return tokens;
  try {
    const body = qs.stringify({
      client_id: config.yahooClientId,
      client_secret: config.yahooClientSecret,
      redirect_uri: config.yahooRedirectUri,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    });
    const { data } = await axios.post(`${OAUTH_BASE}/oauth2/get_token`, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    saveTokens(data);
    return loadTokens();
  } catch (err) {
    logger.error('Failed to refresh Yahoo tokens', err);
    return null;
  }
}

/**
 * One-time code exchange using env var YAHOO_AUTH_CODE.
 * Uses Basic auth and redirect_uri=oob per manual device-style flow.
 * If successful, saves tokens and logs a message. Safe to call repeatedly; no-op if not present.
 */
export async function exchangeEnvAuthCodeIfPresent(): Promise<boolean> {
  const code = process.env.YAHOO_AUTH_CODE;
  if (!code) return false;
  try {
    const auth = Buffer.from(`${config.yahooClientId}:${config.yahooClientSecret}`).toString('base64');
    const body = qs.stringify({
      client_id: config.yahooClientId,
      client_secret: config.yahooClientSecret,
      redirect_uri: 'oob',
      code,
      grant_type: 'authorization_code',
    });
    const { data } = await axios.post(`${OAUTH_BASE}/oauth2/get_token`, body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${auth}`,
      },
    });
    saveTokens(data);
    logger.info('Exchanged YAHOO_AUTH_CODE and saved tokens. Consider removing YAHOO_AUTH_CODE from .env');
    envAuthUsedThisRun = true;
    return true;
  } catch (err) {
    logger.error('Failed to exchange YAHOO_AUTH_CODE', err);
    return false;
  }
}

export function getEnvAuthCodeUsedThisRun() {
  return envAuthUsedThisRun;
}
