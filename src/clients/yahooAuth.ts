import axios from 'axios';
import qs from 'qs';
import express from 'express';
import https from 'https';
import fs from 'fs';
import open from 'open';
import { config } from '../config.js';
import { saveTokens, loadTokens, TokenBundle, saveCodeVerifier, loadCodeVerifier } from '../store/tokenStore.js';
import { logger } from '../logger.js';
import { ensureSelfSignedCert } from '../index.js';
import crypto from 'crypto'; // Import crypto

const OAUTH_BASE = 'https://api.login.yahoo.com';
let envAuthUsedThisRun = false;

function base64URLEncode(str: Buffer): string {
  return str.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function sha256(buffer: Buffer): Buffer {
  return crypto.createHash('sha256').update(buffer).digest();
}

export function getAuthUrl(state = 'state123'): string {
  const codeVerifier = base64URLEncode(crypto.randomBytes(32));
  saveCodeVerifier(codeVerifier); // Save codeVerifier
  const codeChallenge = base64URLEncode(sha256(Buffer.from(codeVerifier)));

  const params = new URLSearchParams({
    client_id: config.yahooClientId,
    redirect_uri: config.yahooRedirectUri,
    response_type: 'code',
    language: 'en-us',
    scope: config.yahooScope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${OAUTH_BASE}/oauth2/request_auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenBundle> {
  const codeVerifier = loadCodeVerifier(); // Load codeVerifier
  if (!codeVerifier) {
    throw new Error('Code verifier not found. PKCE flow error.');
  }

  const body = qs.stringify({
    client_id: config.yahooClientId,
    redirect_uri: config.yahooRedirectUri,
    code,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier, // Pass code_verifier
  });
  const { data } = await axios.post(`${OAUTH_BASE}/oauth2/get_token`, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  saveTokens(data);
  return loadTokens()!;
}

export async function authViaCLI(): Promise<TokenBundle> {
  const existingTokens = await refreshTokensIfNeeded();
  if (existingTokens) {
    return existingTokens;
  }

  return new Promise<TokenBundle>(async (resolve, reject) => {
    const app = express();
    const certs = ensureSelfSignedCert();
    if (!certs) {
      const error = 'Failed to generate self-signed certificate for HTTPS server.';
      logger.error(error);
      return reject(new Error(error));
    }

    const server = https.createServer({
      key: fs.readFileSync(certs.keyFile),
      cert: fs.readFileSync(certs.certFile),
    }, app);

    app.get('/auth/callback', async (req, res) => {
      const code = req.query.code as string;
      if (!code) {
        const error = 'Authorization code not found in callback.';
        logger.error(error);
        res.status(400).send(error);
        reject(new Error(error));
        return;
      }

      try {
        res.send('Authentication successful! You can close this window.');
        const tokens = await exchangeCodeForTokens(code);
        resolve(tokens);
      } catch (err) {
        const error = 'Failed to exchange code for tokens.';
        logger.error(error, err);
        res.status(500).send(error);
        reject(err);
      } finally {
        server.close();
      }
    });

    server.listen(3443, async () => {
      const authUrl = getAuthUrl();
      console.log('Opening browser for authentication...');
      await open(authUrl);
    });
  });
}

export async function refreshTokensIfNeeded(): Promise<TokenBundle | null> {
  const tokens = loadTokens();
  if (!tokens) return null;
  const expiresAt = tokens.obtained_at + tokens.expires_in - 60; // refresh 1m early
  if (Date.now() / 1000 < expiresAt) return tokens;
  try {
    const body = qs.stringify({
      client_id: config.yahooClientId,
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
    const body = qs.stringify({
      client_id: config.yahooClientId,
      redirect_uri: 'oob',
      code,
      grant_type: 'authorization_code',
    });
    const { data } = await axios.post(`${OAUTH_BASE}/oauth2/get_token`, body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
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