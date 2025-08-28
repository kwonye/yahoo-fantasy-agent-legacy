import { Router } from 'express';
import { assertYahooSecrets, config } from './config.js';
import { getAuthUrl, exchangeCodeForTokens, exchangeEnvAuthCodeIfPresent, getEnvAuthCodeUsedThisRun } from './clients/yahooAuth.js';
import { runLineup, runTrade, runWaivers } from './services/managerService.js';
import { loadTokens, saveTokens, TokenBundle } from './store/tokenStore.js';
import fs from 'fs';
import path from 'path';
import { getLeagueSettings } from './clients/yahooFantasy.js';
import { getEffectiveLeagueSettings } from './util/leagueSettings.js';

export const router = Router();

router.get('/auth/login', async (req, res) => {
  assertYahooSecrets();
  if (process.env.YAHOO_AUTH_CODE) {
    // Bypass redirect: use env-provided auth code flow instead
    const used = await exchangeEnvAuthCodeIfPresent();
    if (used) return res.json({ ok: true, method: 'env_code', tokens: !!loadTokens() });
    return res.status(400).json({ ok: false, error: 'YAHOO_AUTH_CODE present but exchange failed' });
  }
  const state = (req.query.state as string) || 'state123';
  const url = getAuthUrl(state);
  res.redirect(url);
});

// Debug: Inspect the exact Yahoo OAuth URL and configured redirect
router.get('/auth/url', (_req, res) => {
  try {
    assertYahooSecrets();
    const state = 'debug';
    const url = getAuthUrl(state);
    res.json({ authUrl: url, configuredRedirectUri: config.yahooRedirectUri });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to build auth URL' });
  }
});

router.get('/auth/callback', async (req, res) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  if (!code) return res.status(400).json({ error: 'Missing code' });
  await exchangeCodeForTokens(code);
  res.json({ ok: true, state, tokens: !!loadTokens() });
});

// Manual auth helpers
router.get('/auth/status', (_req, res) => {
  const t = loadTokens();
  if (!t) return res.json({ hasTokens: false });
  const now = Math.floor(Date.now() / 1000);
  const expires_at = t.obtained_at + t.expires_in;
  res.json({
    hasTokens: true,
    token_type: t.token_type,
    obtained_at: t.obtained_at,
    expires_in: t.expires_in,
    expires_at,
    expires_in_seconds: Math.max(0, expires_at - now),
    env_code_present: !!process.env.YAHOO_AUTH_CODE,
    env_code_used_this_run: getEnvAuthCodeUsedThisRun(),
  });
});

router.post('/auth/exchange', async (req, res) => {
  try {
    const code = req.body?.code as string;
    if (!code) return res.status(400).json({ error: 'Missing code' });
    const tokens = await exchangeCodeForTokens(code);
    res.json({ ok: true, hasTokens: !!tokens });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to exchange code' });
  }
});

router.post('/auth/tokens', (req, res) => {
  try {
    const body = req.body || {};
    const required = ['access_token', 'refresh_token', 'token_type', 'expires_in'] as const;
    for (const k of required) {
      if (!body[k]) return res.status(400).json({ error: `Missing field: ${k}` });
    }
    const input = {
      access_token: String(body.access_token),
      refresh_token: String(body.refresh_token),
      token_type: String(body.token_type),
      expires_in: Number(body.expires_in),
      xoauth_yahoo_guid: body.xoauth_yahoo_guid ? String(body.xoauth_yahoo_guid) : undefined,
    } as Omit<TokenBundle, 'obtained_at'>;
    saveTokens(input);
    res.json({ ok: true, hasTokens: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to save tokens' });
  }
});

// Use one-time YAHOO_AUTH_CODE from env to exchange for tokens
router.post('/auth/use-env-code', async (_req, res) => {
  try {
    const used = await exchangeEnvAuthCodeIfPresent();
    if (!used) return res.status(400).json({ ok: false, error: 'YAHOO_AUTH_CODE not set or exchange failed' });
    res.json({ ok: true, hasTokens: !!loadTokens() });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to process env code' });
  }
});

router.get('/config', (_req, res) => {
  res.json({
    leagueKey: config.leagueKey,
    teamKey: config.teamKey,
    hasTokens: !!loadTokens(),
    hasAI: !!config.geminiApiKey,
  });
});

// League settings from Yahoo API
router.get('/league/settings', async (_req, res) => {
  try {
    if (!config.leagueKey) return res.status(400).json({ error: 'Missing YAHOO_LEAGUE_KEY' });
    const raw = await getLeagueSettings(config.leagueKey);
    const bundle = await getEffectiveLeagueSettings();
    res.json({ settingsRaw: raw, normalized: bundle.yahooNormalized, overrides: bundle.overrides, effective: bundle.effective });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to fetch league settings' });
  }
});

// Local league overrides from config/app.config.json (if present)
router.get('/league/settings/local', (_req, res) => {
  try {
    const overrides = readLocalLeagueOverrides();
    res.json({ overrides, found: !!overrides });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to read local settings' });
  }
});

function readLocalLeagueOverrides(): any | null {
  try {
    const cfgPath = path.join(process.cwd(), 'config', 'app.config.json');
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.league || null;
  } catch {
    return null;
  }
}

router.get('/setup-status', (_req, res) => {
  const checks = {
    yahooClientId: !!config.yahooClientId,
    yahooClientSecret: !!config.yahooClientSecret,
    yahooRedirectUri: !!config.yahooRedirectUri,
    leagueKey: !!config.leagueKey,
    teamKey: !!config.teamKey,
    geminiApiKey: !!config.geminiApiKey,
    hasTokens: !!loadTokens(),
  };
  
  const allConfigured = Object.values(checks).every(Boolean);
  const envCodePresent = !!process.env.YAHOO_AUTH_CODE;
  const needsAuth = checks.yahooClientId && checks.yahooClientSecret && !checks.hasTokens && !envCodePresent;
  
  res.json({
    ...checks,
    envCodePresent,
    allConfigured,
    needsAuth,
    nextSteps: allConfigured 
      ? ['✅ All set! Bot is ready to manage your team.']
      : [
          !checks.yahooClientId ? '1. Create Yahoo Developer app and set YAHOO_CLIENT_ID' : null,
          !checks.yahooClientSecret ? '2. Set YAHOO_CLIENT_SECRET from your Yahoo app' : null,
          !checks.leagueKey ? '3. Set YAHOO_LEAGUE_KEY (e.g., nfl.l.12345)' : null,
          !checks.teamKey ? '4. Set YAHOO_TEAM_KEY (e.g., nfl.l.12345.t.1)' : null,
          !checks.geminiApiKey ? '5. Get Gemini API key and set GEMINI_API_KEY' : null,
          needsAuth ? '6. Visit /auth/login to authenticate with Yahoo' : null,
          !checks.hasTokens && envCodePresent ? '6. YAHOO_AUTH_CODE detected; server will exchange automatically or call POST /auth/use-env-code' : null,
        ].filter(Boolean)
  });
});

router.post('/actions/lineup', async (_req, res) => {
  try {
    const result = await runLineup();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed lineup' });
  }
});

router.post('/actions/waivers', async (_req, res) => {
  try {
    const result = await runWaivers();
    res.json(result ?? { applied: false, rationale: 'No waiver move' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed waivers' });
  }
});

router.post('/actions/trades', async (_req, res) => {
  try {
    const result = await runTrade();
    res.json(result ?? { proposed: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed trade' });
  }
});

router.post('/actions/run-all', async (_req, res) => {
  try {
    const lineup = await runLineup();
    const waivers = await runWaivers();
    const trade = await runTrade();
    res.json({ lineup, waivers, trade });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed run-all' });
  }
});
