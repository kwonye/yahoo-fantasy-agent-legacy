import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { DecisionType } from '../models/Common';
import { BotController } from '../controllers/BotController';
import { Scheduler } from '../services/Scheduler';
import { YahooOAuthClient } from '../services/YahooOAuthClient';
import { YahooApiService } from '../services/YahooApiService';
import { GeminiClient } from '../services/GeminiClient';
import { GeminiLog } from '../services/GeminiLog';
import { KickoffScheduler } from '../services/KickoffScheduler';
import { ConfigManager } from '../services/ConfigManager';
import { filterActionableIncomingTrades } from '../lib/tradeFilters';
import type { AppSettings } from '../models/Config';

dotenv.config();

export const app = express();
app.set('trust proxy', true);
const defaultPort = parseInt(process.env.PORT || '3000', 10);
let scheduler: Scheduler | null = null;
let incomingTradeWatcher: NodeJS.Timeout | null = null;
let tradeEvalScheduler: Scheduler | null = null;
// runtime state is sourced from AppSettings
const cmInit = new ConfigManager();
let appSettings = cmInit.loadAppSettings();
// Simple cache for expensive computations (trade block)
const tradeBlockCache = new Map<string, { ts: number; data: { needs: string[]; surplus: string[]; reasoning: string } }>();
const TRADE_BLOCK_TTL_MS = 2 * 60 * 1000;

// ---------- Helpers: normalize League/Team keys ----------
function normalizeLeagueKeyInput(input: any): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  if (/^nfl\.l\.\d+$/i.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `nfl.l.${raw}`;
  const m = raw.match(/(\d{4,})/);
  if (m) return `nfl.l.${m[1]}`;
  return raw;
}

function normalizeTeamKeyInput(leagueKeyMaybe: any, input: any): string {
  const lk = normalizeLeagueKeyInput(leagueKeyMaybe);
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  if (/^nfl\.l\.\d+\.t\.\d+$/i.test(raw)) return raw;
  if (/^\d+$/.test(raw)) {
    return lk ? `${lk}.t.${raw}` : raw; // if no league known, return digits and let caller handle
  }
  const m = raw.match(/(?:^|\.)t\.(\d+)$/i);
  if (m && lk) return `${lk}.t.${m[1]}`;
  return raw;
}

// Simple Server-Sent Events (SSE) broadcaster for push updates
const sseClients = new Set<http.ServerResponse>();
function sseBroadcast(event: string, payload: any) {
  const data = JSON.stringify(payload ?? {});
  for (const res of sseClients) {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${data}\n\n`);
    } catch {
      // Drop broken clients silently
    }
  }
}

function configureIncomingTradeWatcher(app: AppSettings): void {
  try {
    if (incomingTradeWatcher) {
      clearInterval(incomingTradeWatcher);
      incomingTradeWatcher = null;
    }
  } catch { }
  if (!app.tradeResponsesAutomationEnabled) return;
  const lk = app.leagueKey || '';
  const tk = app.teamKey || '';
  if (!lk || !tk) return;

  const intervalMs = 60 * 60 * 1000;
  let running = false;
  const runCheck = async () => {
    if (running) return;
    running = true;
    try {
      const bot = new BotController({ leagueKey: lk, teamKey: tk });
      await bot.runIncomingTradeCheck();
    } catch (err) {
      console.warn('Incoming trade watcher error:', (err as Error).message);
    } finally {
      running = false;
    }
  };

  void runCheck();
  incomingTradeWatcher = setInterval(() => {
    void runCheck();
  }, intervalMs);
  console.log('Incoming trade watcher enabled (every 60 min).');
}

function configureTradeEvaluationScheduler(app: AppSettings): void {
  try {
    if (tradeEvalScheduler) {
      tradeEvalScheduler.stop();
      tradeEvalScheduler = null;
    }
  } catch { }
  try { (global as any).__tradeEval = null; } catch { }
  if (!app.tradesAutomationEnabled) return;
  const lk = app.leagueKey || '';
  const tk = app.teamKey || '';
  if (!lk || !tk) return;

  const hour = Number.isFinite(app.scheduleHour) ? app.scheduleHour : 9;
  const minute = Number.isFinite(app.scheduleMinute) ? app.scheduleMinute : 0;
  const task = async () => {
    const bot = new BotController({ leagueKey: lk, teamKey: tk });
    await bot.runTradeEvaluations();
  };
  tradeEvalScheduler = new Scheduler(task, { hour, minute, runOnStart: false });
  tradeEvalScheduler.start();
  try { (global as any).__tradeEval = tradeEvalScheduler; } catch { }
  console.log(`Trade evaluation scheduler enabled (daily at ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}).`);
}

app.use(express.json());

// Dashboard password requirement removed; all dashboard routes are public in local development.

app.use(express.static(path.join(process.cwd(), 'public')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ---------------- Yahoo OAuth ----------------
function computeRedirectUri(req: express.Request, overridePath?: '/auth/callback' | '/oauth/callback'): string {
  const cm = new ConfigManager();
  const settings = cm.loadAppSettings();
  const env = (settings.redirectUri || '').trim();
  if (env) {
    if (overridePath) {
      try {
        const u = new URL(env);
        u.pathname = overridePath;
        u.search = '';
        return u.toString();
      } catch { }
    }
    return env;
  }
  // Otherwise, derive from request and use /auth/callback as default path
  const inferred = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const proto = 'https';
  const host = req.headers.host || `localhost:${defaultPort}`;
  const path = overridePath ?? '/auth/callback';
  return `${proto}://${host}${path}`;
}

// Redirect user to Yahoo authorization URL
app.get('/auth/yahoo/start', (req, res) => {
  try {
    const cm = new ConfigManager();
    const oauth = new YahooOAuthClient(cm);
    const cbParam = String((req.query.cb || '').toString());
    const forcedPath = cbParam === 'oauth' ? '/oauth/callback' : cbParam === 'auth' ? '/auth/callback' : undefined;
    const redirectUri = computeRedirectUri(req, forcedPath as any);
    const state = crypto.randomBytes(8).toString('hex');
    const scope = String((req.query.scope as string) || process.env.YAHOO_SCOPE || 'fspt-w');
    const url = oauth.getAuthorizationUrl(redirectUri, state, scope);
    try {
      const creds = (cm.loadYahooCredentials() || {}) as any;
      const clientId = String(creds.clientId || '').trim();
      if (!clientId) {
        res.status(400).send('Yahoo client credentials are not configured. Save them in the dashboard first.');
        return;
      }
      console.log('[OAuth-start] clientId=%s redirect_uri=%s scope=%s', clientId.slice(0, 3) + '***', redirectUri, scope);
      if (String(process.env.DEBUG_OAUTH || '0') === '1') {
        console.log('[OAuth-start-url]', url);
      }
    } catch { }
    // Optionally set state cookie for CSRF (not validated yet)
    try { res.cookie?.('oauth_state', state, { httpOnly: true, sameSite: 'lax' } as any); } catch { }
    res.redirect(url);
  } catch (e) {
    res.status(500).send('OAuth start failed: ' + (e as Error).message);
  }
});

// OAuth callback: capture ?code=... and exchange for tokens automatically
async function handleYahooCallback(req: express.Request, res: express.Response) {
  const code = String(req.query.code || '').trim();
  const error = String(req.query.error || '').trim();
  if (error) {
    res.status(400).send(`OAuth error: ${error}`);
    return;
  }
  if (!code) {
    res.status(400).send('Missing authorization code.');
    return;
  }
  try {
    const cm = new ConfigManager();
    const oauth = new YahooOAuthClient(cm);
    const proto = 'https'; // Force HTTPS for callback URI matching
    const host = req.headers.host || `localhost:${defaultPort}`;
    const redirectFromReq = `${proto}://${host}${req.path}`;
    const debug = String(process.env.DEBUG_OAUTH || '0') === '1';
    const attempt = async (uri: string) => {
      if (debug) console.log('[OAuth] Exchanging code with redirect_uri=', uri);
      return oauth.exchangeCodeForToken(code, uri);
    };
    try {
      await attempt(redirectFromReq);
    } catch (e1: any) {
      const msg1 = e1 && e1.message ? e1.message : String(e1);
      if (debug) console.warn('[OAuth] First exchange failed:', msg1);
      throw new Error(`OAuth exchange failed (redirect_uri=${redirectFromReq}): ${msg1}`);
    }
    // Redirect back to dashboard with a success flag
    const base = `${(req.headers['x-forwarded-proto'] as string) || req.protocol || 'http'}://${req.headers.host}`;
    res.redirect(base + '/?yahoo=connected');
  } catch (e) {
    res.status(500).send('OAuth exchange failed: ' + (e as Error).message);
  }
}

// Support both legacy and new callback paths
app.get('/oauth/callback', handleYahooCallback);
app.get('/auth/callback', handleYahooCallback);

// Manual OAuth code exchange: accept a pasted callback URL or explicit code + redirectUri
function extractCodeAndRedirect(fromUrl: string): { code?: string; redirectUri?: string; state?: string } {
  try {
    const u = new URL(fromUrl);
    const code = u.searchParams.get('code') || undefined;
    const state = u.searchParams.get('state') || undefined;
    // redirectUri must match authorization request redirect without query
    const redirectUri = `${u.protocol}//${u.host}${u.pathname}`;
    if (code) return { code, redirectUri, state };
  } catch {
    // Fallback: naive parse for code= when URL constructor fails
    const idx = fromUrl.indexOf('code=');
    if (idx >= 0) {
      const rest = fromUrl.slice(idx + 5);
      const code = rest.split(/[&#?]/)[0];
      // Try to salvage origin/path up to first '?'
      const q = fromUrl.indexOf('?');
      if (q > 0) {
        try {
          const base = new URL(fromUrl.slice(0, q));
          const redirectUri = `${base.protocol}//${base.host}${base.pathname}`;
          return { code, redirectUri };
        } catch { }
      }
      return { code };
    }
  }
  return {};
}

app.post('/api/oauth/exchange', async (req, res) => {
  const rawUrl = String((req.body?.url || '').toString()).trim();
  let code = String((req.body?.code || '').toString()).trim();
  let redirectUri = String((req.body?.redirectUri || '').toString()).trim();
  try {
    if (rawUrl) {
      const parsed = extractCodeAndRedirect(rawUrl);
      if (parsed.code) code = parsed.code;
      if (parsed.redirectUri) redirectUri = parsed.redirectUri;
    }
    if (!code) { res.status(400).json({ ok: false, error: 'Missing authorization code' }); return; }
    if (!redirectUri) {
      redirectUri = computeRedirectUri(req);
    }
    const cm = new ConfigManager();
    const oauth = new YahooOAuthClient(cm);
    if (String(process.env.DEBUG_OAUTH || '0') === '1') {
      console.log('[OAuth] Manual exchange attempt', { redirectUri, codeLen: code.length });
    }
    const tok = await oauth.exchangeCodeForToken(code, redirectUri);
    res.json({ ok: true, token: { hasAccess: !!tok.accessToken, hasRefresh: !!tok.refreshToken, expiresAt: tok.expiresAt } });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Debug: show effective OAuth config
app.get('/api/oauth/info', (req, res) => {
  try {
    const cm = new ConfigManager();
    const redirectUri = computeRedirectUri(req);
    let clientId = '';
    try { clientId = String((cm.loadYahooCredentials() as any)?.clientId || ''); } catch { }
    res.json({ ok: true, redirectUri, clientIdMasked: clientId ? (clientId.slice(0, 3) + '***' + clientId.slice(-2)) : '' });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Event stream for client auto-refresh
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Initial comment to open the stream
  res.write(': connected\n\n');
  sseClients.add(res);
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { }
  }, 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });

});


const { DailyScheduler } = require('../services/DailyScheduler');
const { GeminiQuota } = require('../services/GeminiQuota');
const dailyScheduler = new DailyScheduler(() => {
  GeminiQuota.getInstance().reset();
}, { hour: 0, minute: 0 });
dailyScheduler.start();

// Gemini quota status
app.get('/api/quota', (_req, res) => {
  try {
    // Read internals by getting remaining and limit; date is implied by file contents
    const remaining = GeminiQuota.getInstance().getRemaining();
    const limit = GeminiQuota.getInstance().getLimit();
    res.json({ ok: true, limit, remaining, date: new Date().toISOString().slice(0, 10) });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Upcoming automation schedule preview (waivers + kickoff checks)
app.get('/api/schedule/preview', (_req, res) => {
  try {
    const cm = new ConfigManager();
    const app = cm.loadAppSettings();
    // Waiver schedule
    let waiver: any = { enabled: !!app.waiverAutomationEnabled };
    if (waiver.enabled) {
      // Determine source and compute next run
      let source: 'env' | 'league_profile' | 'default' = 'default';
      let day = 2, hour = 7, minute = 0;
      if (app.waiverDay !== undefined || app.waiverHour !== undefined || app.waiverMinute !== undefined) {
        day = parseInt(String(app.waiverDay ?? '2'), 10) || 2;
        hour = parseInt(String(app.waiverHour ?? '7'), 10) || 7;
        minute = parseInt(String(app.waiverMinute ?? '0'), 10) || 0;
        source = 'env';
      } else {
        try {
          const lp: any = cm.loadLeagueProfile();
          const wt = lp?.meta?.waiverTime as string | undefined;
          if (wt && typeof wt === 'string') {
            const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
            const lower = wt.toLowerCase();
            let d = days.findIndex((x) => lower.includes(x)); if (d < 0) d = 2;
            const tm = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
            let h = 7, m = 0; if (tm) { h = parseInt(String(tm[1]), 10); m = tm[2] ? parseInt(String(tm[2]), 10) : 0; const ap = tm[3]; if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; }
            day = d; hour = h; minute = m; source = 'league_profile';
          }
        } catch { }
      }
      const next = (() => { const now = new Date(); const d = new Date(now); const delta = (day - d.getDay() + 7) % 7; d.setDate(d.getDate() + delta); d.setHours(hour, minute, 0, 0); if (d <= now) d.setDate(d.getDate() + 7); return d; })();
      waiver = { enabled: true, day, hour, minute, nextRunISO: next.toISOString(), source };
    }
    // Kickoff pre-checks schedule (next few occurrences)
    const kickoffEnabled = !!app.kickoffEnabled;
    const preMinutes = [30]; // ONLY run 30 minutes before kickoff
    const windows = [
      { dow: 4, hh: 20, mm: 20 },
      { dow: 0, hh: 13, mm: 0 },
      { dow: 0, hh: 16, mm: 25 },
      { dow: 0, hh: 20, mm: 20 },
      { dow: 1, hh: 20, mm: 15 },
    ];
    const upcoming: Array<{ runAtISO: string; preMinutes: number; window: { dow: number; hh: number; mm: number } }> = [];
    if (kickoffEnabled) {
      const { DateTime } = require('luxon');
      const zone = 'America/New_York'; // NFL kickoff windows are defined in ET
      const nowMillis = Date.now();
      const now = DateTime.now().setZone(zone);
      const nextDowTimeZoned = (dow: number, hh: number, mm: number) => {
        const currDow0 = now.weekday % 7; // 0..6
        const delta = (dow - currDow0 + 7) % 7;
        let dt = now.plus({ days: delta }).set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
        if (dt.toMillis() <= nowMillis) dt = dt.plus({ days: 7 });
        return dt;
      };
      const windowsEt = [
        { dow: 4, hh: 20, mm: 15 }, // Thu 8:15 PM ET
        { dow: 0, hh: 9, mm: 30 }, // Sun 9:30 AM ET (international weeks only)
        { dow: 0, hh: 13, mm: 0 }, // Sun 1:00 PM ET
        { dow: 0, hh: 16, mm: 5 }, // Sun 4:05 PM ET
        { dow: 0, hh: 16, mm: 25 }, // Sun 4:25 PM ET
        { dow: 0, hh: 20, mm: 20 }, // Sun 8:20 PM ET
        { dow: 1, hh: 20, mm: 15 }, // Mon 8:15 PM ET
      ];
      for (const w of windowsEt) {
        const kickoff = nextDowTimeZoned(w.dow, w.hh, w.mm).toMillis();
        for (const pre of preMinutes) {
          const runAt = new Date(kickoff - pre * 60000);
          if (runAt.getTime() > nowMillis) upcoming.push({ runAtISO: runAt.toISOString(), preMinutes: pre, window: w });
        }
      }
      // Sort by soonest and keep next ~10
      upcoming.sort((a, b) => new Date(a.runAtISO).getTime() - new Date(b.runAtISO).getTime());
    }
    const tradeEvalEnabled = !!app.tradesAutomationEnabled;
    let tradeEval: any = { enabled: tradeEvalEnabled };
    if (tradeEvalEnabled) {
      const next = (() => {
        const now = new Date();
        const d = new Date(now);
        const hour = Number.isFinite(app.scheduleHour) ? app.scheduleHour : 9;
        const minute = Number.isFinite(app.scheduleMinute) ? app.scheduleMinute : 0;
        d.setHours(hour, minute, 0, 0);
        if (d <= now) d.setDate(d.getDate() + 1);
        return d;
      })();
      tradeEval = { enabled: true, hour: app.scheduleHour, minute: app.scheduleMinute, nextRunISO: next.toISOString() };
    }
    res.json({ ok: true, waiver, kickoff: { enabled: kickoffEnabled, preMinutes, upcoming }, tradeEval });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});



function mask(s?: string) {
  if (!s) return '';
  return s.length <= 4 ? '*'.repeat(s.length) : `${s.slice(0, 3)}***${s.slice(-2)}`;
}

app.get('/api/creds', (_req, res) => {
  try {
    const cm = new ConfigManager();
    let yahoo: any = null;
    let gemini: any = null;
    let source: 'store' | null = null;
    try { yahoo = cm.loadYahooCredentials(); } catch { }
    try { gemini = cm.loadGeminiCredentials(); } catch { }
    if (yahoo) source = 'store';
    // Do not fallback to environment for Gemini API key; require saving via dashboard
    const responseData = {
      ok: true, creds: {
        yahoo: yahoo ? { clientId: mask(yahoo.clientId), hasRefresh: !!yahoo.refreshToken, source } : null,
        gemini: gemini ? { apiKey: mask(gemini.apiKey), model: (gemini as any).model || 'gemini-2.5-flash' } : null,
      }
    };
    console.log('[/api/creds] Sending response:', responseData);
    res.json(responseData);
  } catch (e) {
    console.error('[/api/creds] Error:', e);
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.post('/api/creds/yahoo', (req, res) => {
  try {
    const cm = new ConfigManager();
    const body = req.body || {};
    const existing = (() => { try { return cm.loadYahooCredentials(); } catch { return null; } })();
    const next = {
      clientId: String(body.clientId || ''),
      clientSecret: String(body.clientSecret || ''),
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
    };
    // If clientId changes, clear any stored OAuth token to avoid mismatch
    if (existing && existing.clientId && String(existing.clientId) !== next.clientId) {
      try { cm.deleteYahooAuthToken(); } catch { }
    }
    cm.saveYahooCredentials(next);
    res.json({ ok: true });
    sseBroadcast('creds', { source: 'yahoo' });
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

app.post('/api/creds/gemini', (req, res) => {
  try {
    const cm = new ConfigManager();
    const body = req.body || {};
    cm.saveGeminiCredentials({ apiKey: String(body.apiKey || ''), model: body.model ? String(body.model) : undefined });
    res.json({ ok: true });
    sseBroadcast('creds', { source: 'gemini' });
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

// Return raw Gemini credentials (unmasked) for local display in the dashboard
app.get('/api/creds/gemini/raw', (_req, res) => {
  try {
    try { res.setHeader('Cache-Control', 'no-store'); } catch { }
    const cm = new ConfigManager();
    const c = cm.loadGeminiCredentials();
    if (!c) { res.json({ ok: false, error: 'No Gemini credentials saved' }); return; }
    res.json({ ok: true, apiKey: c.apiKey || '', model: (c as any).model || '', geminiQuota: c.geminiQuota });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Return raw Yahoo client credentials (unmasked) for local display in the dashboard
// Note: Intended for local use; avoid exposing broadly.
app.get('/api/creds/yahoo/raw', (_req, res) => {
  try {
    try { res.setHeader('Cache-Control', 'no-store'); } catch { }
    const cm = new ConfigManager();
    const c = cm.loadYahooCredentials();
    if (!c) { res.json({ ok: false, error: 'No Yahoo credentials saved' }); return; }
    res.json({ ok: true, clientId: c.clientId || '', clientSecret: c.clientSecret || '' });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.post('/api/bot/run', async (req, res) => {
  const s = new ConfigManager().loadAppSettings();
  const leagueKey = normalizeLeagueKeyInput(req.body?.leagueKey || s.leagueKey);
  const teamKey = normalizeTeamKeyInput(leagueKey || s.leagueKey, req.body?.teamKey || s.teamKey);
  if (!leagueKey || !teamKey) {
    res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey' }); return;
  }
  try {
    const bot = new BotController({ leagueKey, teamKey });
    await bot.runDaily();
    res.json({ ok: true });
    sseBroadcast('activity', { botRun: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.get('/api/roster', async (req, res) => {
  const s = new ConfigManager().loadAppSettings();
  const teamKey = normalizeTeamKeyInput(s.leagueKey, (req.query.teamKey as string) || s.teamKey);
  if (!teamKey) {
    res.status(400).json({ ok: false, error: 'Missing teamKey' });
    return;
  }
  try {
    const cm = new ConfigManager();
    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);
    const entries = await api.getTeamRosterWithSlots(teamKey);
    // Strip points fields from response
    const sanitized = entries.map((e) => ({
      slot: e.slot,
      player: { id: e.player.id, name: e.player.name, position: e.player.position, team: e.player.team, status: e.player.status },
    }));
    res.json({ ok: true, roster: sanitized });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});


app.get('/api/league', async (req, res) => {
  const s = new ConfigManager().loadAppSettings();
  const leagueKey = normalizeLeagueKeyInput((req.query.leagueKey as string) || s.leagueKey);
  if (!leagueKey) {
    res.status(400).json({ ok: false, error: 'Missing leagueKey' });
    return;
  }
  try {
    const cm = new ConfigManager();
    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);
    const league = await api.getLeague(leagueKey);
    const leagueProfile = new ConfigManager().loadLeagueProfile(leagueKey);
    res.json({ ok: true, league });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// League scoring/settings profile (single file: config/league_setting.json)
app.get('/api/league-config', (_req, res) => {
  try {
    const cm = new ConfigManager();
    let profile = cm.loadLeagueProfile();
    if (!profile) {
      // Fallback: dynamically pick the first JSON from a nearby config directory
      try {
        const pathMod = require('path');
        const fsMod = require('fs');
        const tryDir = (dir: string) => {
          if (!fsMod.existsSync(dir)) return null;
          const files = fsMod.readdirSync(dir).filter((f: string) => f.toLowerCase().endsWith('.json'));
          if (files.length === 0) return null;
          const preferredOrder = (name: string) =>
            name === 'league_setting.json' ? 0 :
              name.toLowerCase().includes('league') ? 1 :
                2;
          files.sort((a: string, b: string) => preferredOrder(a) - preferredOrder(b));
          const chosen = files[0];
          if (!chosen) return null;
          const chosenPath = pathMod.join(dir, chosen);
          const raw = fsMod.readFileSync(chosenPath, 'utf8');
          const obj = JSON.parse(raw);
          // Normalize to canonical path for future
          const target = pathMod.join(dir, 'league_setting.json');
          try { fsMod.writeFileSync(target, JSON.stringify(obj, null, 2), 'utf8'); } catch { }
          return obj;
        };
        // Try cwd/config, then walk up to find a config dir
        const cwd = process.cwd();
        profile = tryDir(pathMod.join(cwd, 'config')) || null;
        if (!profile) {
          let p = pathMod.resolve(__dirname);
          for (let i = 0; i < 6 && !profile; i++) {
            profile = tryDir(pathMod.join(p, 'config')) || null;
            const next = pathMod.dirname(p);
            if (next === p) break;
            p = next;
          }
        }
      } catch { }
    }
    res.json({ ok: true, profile: profile ?? null });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Serve raw league_setting.json for client-side fallback
const serveLeagueJson = (_req: any, res: any) => {
  try {
    const p = require('path').join(process.cwd(), 'config', 'league_setting.json');
    const fs = require('fs');
    if (!fs.existsSync(p)) { res.status(404).json({ ok: false, error: 'Not found' }); return; }
    res.setHeader('Content-Type', 'application/json');
    res.send(fs.readFileSync(p));
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
};
app.get('/config/league_setting.json', serveLeagueJson);
// Support subpath deployments: any path ending with /config/league_setting.json
app.get(/.*\/config\/league_setting\.json$/, serveLeagueJson);

app.post('/api/league-config', (req, res) => {
  try {
    const body = req.body || {};
    const cm = new ConfigManager();
    const saved = cm.saveLeagueProfile(body);
    res.json({ ok: true, profile: saved });
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

app.get('/api/gemini/logs', (_req, res) => {
  const logs = GeminiLog.readLast(100);
  res.json({ ok: true, logs });
});

app.post('/api/gemini/clear', (_req, res) => {
  GeminiLog.clear();
  res.json({ ok: true });
  sseBroadcast('gemini', { cleared: true });
});

app.post('/api/gemini/test', async (req, res) => {
  const prompt: string = (req.body?.prompt || '').trim();
  const system: string = req.body?.system || 'You are a helpful assistant.';
  try {
    // Ensure API key present and a prompt provided
    const cm = new ConfigManager();
    let hasKey = false;
    try { const g = cm.loadGeminiCredentials(); hasKey = !!g?.apiKey; } catch { }
    if (!hasKey) { res.status(400).json({ ok: false, error: 'Gemini API key missing (save it in the dashboard).' }); return; }
    if (!prompt) { res.status(400).json({ ok: false, error: 'Prompt is required' }); return; }
    const client = new GeminiClient();
    const text = await client.generate(system, prompt);
    res.json({ ok: true, response: text });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.post('/api/test/trade', async (req, res) => {
  try {
    const leagueKey = req.body?.leagueKey || '461.l.12345'; // Use a real league key here
    const myTeamKey = req.body?.myTeamKey || '461.l.12345.t.1'; // Use a real team key here

    const cm = new ConfigManager();
    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);
    const write = new (require('../services/YahooWriteAdapter').YahooWriteAdapter)(api, { debugYahoo: true });

    // 1. Fetch league data to confirm authentication
    const league = await api.getLeague(leagueKey);
    if (!league) {
      res.status(400).json({ ok: false, error: 'Could not fetch league data. Check leagueKey and Yahoo authentication.' });
      return;
    }

    // 2. Get my team's roster and find a kicker
    const myRoster = await api.getTeamRosterWithSlots(myTeamKey);
    const myKicker = myRoster.find(p => p.player.position === 'K');
    if (!myKicker) {
      res.status(400).json({ ok: false, error: 'Could not find a kicker in your roster.' });
      return;
    }

    // 3. Get opponent's team and find a defense
    const allTeams = await api.getLeagueTeams(leagueKey);
    const opponentTeam = allTeams.find(team => team.key !== myTeamKey);
    if (!opponentTeam) {
      res.status(400).json({ ok: false, error: 'Could not find an opponent team in the league.' });
      return;
    }
    const opponentRoster = await api.getTeamRosterWithSlots(opponentTeam.key);
    const opponentDefense = opponentRoster.find(p => p.player.position === 'DEF');
    if (!opponentDefense) {
      res.status(400).json({ ok: false, error: 'Could not find a defense in opponent\'s roster.' });
      return;
    }

    const dummyDecision = {
      shouldTrade: true,
      reasoning: 'Trade proposal: My Kicker for your Defense',
      confidence: 1.0,
      expectedValue: 100,
      proposal: {
        myPlayers: [myKicker.player.id],
        theirPlayers: [opponentDefense.player.id],
        targetTeamId: opponentTeam.key,
        reasoning: 'Trade proposal: My Kicker for your Defense',
      },
    };

    const out = await write.applyTrade(leagueKey, myTeamKey, dummyDecision);

    res.json({ ok: out.success, id: out.id, message: out.success ? 'Trade proposed' : 'Trade proposal failed' });
  } catch (e) {
    console.error('Error in /api/test/trade:', e); // Log the error
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Trades: incoming list
app.get('/api/trades/incoming', async (req, res) => {
  try {
    const s = new ConfigManager().loadAppSettings();
    const leagueKey = normalizeLeagueKeyInput((req.query.leagueKey as string) || s.leagueKey);
    const teamKey = normalizeTeamKeyInput(leagueKey || s.leagueKey, (req.query.teamKey as string) || s.teamKey);
    const debug = String(req.query.debug || '0') === '1';
    if (!leagueKey) { res.status(400).json({ ok: false, error: 'Missing leagueKey' }); return; }
    const cm = new ConfigManager();
    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);
    const dbg = { tried: [] as string[] };
    const prev = process.env.DEBUG_YAHOO;
    if (debug) process.env.DEBUG_YAHOO = '1';
    const tradesAll = await api.getPendingTrades(leagueKey, teamKey, dbg);
    if (debug) process.env.DEBUG_YAHOO = prev;
    const myTeamKey = teamKey || '';
    const trades = filterActionableIncomingTrades(tradesAll, myTeamKey);
    // Append to trades debug log for traceability
    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        leagueKey,
        teamKey,
        tried: dbg.tried,
        totalFound: tradesAll.length,
        afterFilter: trades.length,
        ids: trades.map((t: any) => t.id),
      });
      fs.appendFileSync(path.join(dir, 'trades_debug.log'), line + '\n', 'utf8');
    } catch { }
    res.json({ ok: true, trades, teamKeyUsed: teamKey || null, debug: debug ? { tried: dbg.tried } : undefined });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Dump all transactions (normalized) for diagnostics
app.get('/api/trades/dump', async (req, res) => {
  try {
    const s = new ConfigManager().loadAppSettings();
    const leagueKey = (req.query.leagueKey as string) || s.leagueKey;
    const teamKey = (req.query.teamKey as string) || s.teamKey;
    const count = req.query.count ? parseInt(String(req.query.count), 10) : 200;
    const dbg = { tried: [] as string[] };
    const cm = new ConfigManager();
    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);
    const prev = process.env.DEBUG_YAHOO;
    process.env.DEBUG_YAHOO = '1';
    const items = await api.getAllTransactionsNormalized(leagueKey!, teamKey, count, dbg);
    process.env.DEBUG_YAHOO = prev;
    res.json({ ok: true, tried: dbg.tried, count: items.length, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Trades: evaluate a specific incoming trade via Gemini
app.post('/api/trades/evaluate', async (req, res) => {
  try {
    const s = new ConfigManager().loadAppSettings();
    const leagueKey = req.body?.leagueKey || s.leagueKey;
    const teamKey = req.body?.teamKey || s.teamKey;
    const tradeId = req.body?.tradeId; // e.g., 461.l.399238.pt.2
    if (!leagueKey || !teamKey || !tradeId) { res.status(400).json({ ok: false, error: 'Missing leagueKey, teamKey, or tradeId' }); return; }
    const cm = new ConfigManager();
    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);
    // Load trade transaction to extract moves
    const tx = await api.getTransactionByKey(String(tradeId));
    if (!tx || !Array.isArray(tx.moves) || tx.moves.length === 0) { res.status(404).json({ ok: false, error: 'Trade not found or no moves parsed' }); return; }
    // Load roster and league settings
    const league = await api.getLeague(leagueKey);
    const myEntries = await api.getTeamRosterWithSlots(teamKey);
    const myRoster = myEntries.map((e) => e.player);
    if (myRoster.length === 0) {
      res.json({ ok: true, tradeId, decision: { shouldAccept: false, reasoning: 'My roster is empty', confidence: 1.0 }, needs: [], surplus: [] });
      return;
    }
    const leagueProfile = new ConfigManager().loadLeagueProfile(leagueKey);
    // Needs/surplus analysis
    const gemini = new (require('../services/GeminiClient').GeminiClient)();
    let needs: string[] = [];
    let surplus: string[] = [];
    try {
      const ns = await gemini.analyzeRosterBalance(myRoster, league.settings);
      needs = Array.isArray(ns.needs) ? ns.needs : [];
      surplus = Array.isArray(ns.surplus) ? ns.surplus : [];
    } catch { }
    const decision = await gemini.evaluateIncomingTradeOffer(myRoster, league.settings, needs, surplus, tx.moves, String(teamKey), leagueProfile);
    res.json({ ok: true, tradeId, decision, needs, surplus });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Trades: respond (accept/decline)
app.post('/api/trades/respond', async (req, res) => {
  try {
    const s = new ConfigManager().loadAppSettings();
    const leagueKey = req.body?.leagueKey || s.leagueKey;
    const tradeId = req.body?.tradeId;
    const accept = !!req.body?.accept;
    if (!leagueKey || !tradeId) { res.status(400).json({ ok: false, error: 'Missing leagueKey or tradeId' }); return; }
    const cm = new ConfigManager();
    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);
    const write = new (require('../services/YahooWriteAdapter').YahooWriteAdapter)(api);
    const out = await write.applyTradeResponse(leagueKey, String(tradeId), accept);
    res.json({ ok: out.success });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Trades: fetch by key or trid
app.get('/api/trades/by-key', async (req, res) => {
  try {
    const s = new ConfigManager().loadAppSettings();
    const leagueKey = (req.query.leagueKey as string) || s.leagueKey;
    const trid = req.query.trid as string | undefined;
    const transactionKey = req.query.transactionKey as string | undefined;
    if (!transactionKey && (!leagueKey || !trid)) {
      res.status(400).json({ ok: false, error: 'Missing transactionKey or leagueKey+trid' }); return;
    }
    const cm = new ConfigManager();
    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);
    let out: any = null;
    if (transactionKey) out = await api.getTransactionByKey(transactionKey);
    else out = await api.getTransactionById(leagueKey!, trid!);
    res.json({ ok: true, transaction: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Trades: request Gemini to propose a trade for my team and optionally apply it
app.post('/api/trades/apply', async (req, res) => {
  try {
    const s = new ConfigManager().loadAppSettings();
    const leagueKey = req.body?.leagueKey || s.leagueKey;
    const teamKey = req.body?.teamKey || s.teamKey;
    if (!leagueKey || !teamKey) { res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey' }); return; }

    const cm = new ConfigManager();
    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);
    const write = new (require('../services/YahooWriteAdapter').YahooWriteAdapter)(api);

    // Build my roster and opponents list
    const league = await api.getLeague(leagueKey);
    const myEntries = await api.getTeamRosterWithSlots(teamKey);
    const myRoster = myEntries.map((e) => e.player);
    
    if (myRoster.length === 0) { res.status(400).json({ ok: false, error: 'My roster is empty, cannot evaluate trades' }); return; }

    // Gather opponent teams
    let opponentTeams: Array<{ key: string; name?: string }> = [];
    try { opponentTeams = await api.getLeagueTeams(leagueKey); } catch { }
    const myKeySuffix = (() => { const idx = String(teamKey).lastIndexOf('.t.'); return idx > 0 ? String(teamKey).slice(idx + 3) : ''; })();
    const isMe = (k: string) => k === teamKey || (myKeySuffix && String(k).endsWith('.t.' + myKeySuffix));
    const candidates = (opponentTeams || []).filter((t) => t?.key && !isMe(String(t.key)));
    const oppList: Array<{ teamKey: string; teamName?: string; roster: any[] }> = [];
    for (const opp of candidates) {
      try {
        const entries = await api.getTeamRosterWithSlots(String(opp.key));
        const their = entries.map((e) => e.player);
        if (their.length > 0) oppList.push({ teamKey: String(opp.key), teamName: opp.name, roster: their });
      } catch (e) {
        // ignore opponent fetch errors
      }
    }

    if (oppList.length === 0) { res.status(400).json({ ok: false, error: 'No opponent rosters available to evaluate trades' }); return; }

    // Ask Gemini for the best trade across opponents
    const gemini = new (require('../services/GeminiClient').GeminiClient)();
    const decision = await gemini.evaluateTradesMulti(myRoster, oppList as any, { applyChanges: true }, { week: league.currentWeek, season: league.season, leagueSettings: league.settings });

    // Normalize/validate Gemini proposals for Yahoo (primary + any additional)
    const normalizeTeamKey = (raw: string): string => {
      const gameLeaguePrefix = String(leagueKey);
      const rawTarget = String(raw || '');
      if (rawTarget.includes('.t.')) return rawTarget; // already a full key
      let resolved = rawTarget;
      if (/^\d+$/.test(rawTarget)) resolved = `${gameLeaguePrefix}.t.${rawTarget}`;
      else if (rawTarget) {
        const match = oppList.find(o => (o.teamName || '').toLowerCase() === rawTarget.toLowerCase());
        if (match) resolved = match.teamKey;
      }
      if (!resolved.includes('.t.') && /^\d+$/.test(rawTarget)) resolved = `${gameLeaguePrefix}.t.${rawTarget}`;
      if (!resolved.includes('.t.') && oppList.length > 0) resolved = oppList[0]!.teamKey;
      return resolved;
    };
    if (decision) {
      if (decision.proposal) (decision as any).proposal.targetTeamId = normalizeTeamKey((decision.proposal as any).targetTeamId);
      if (Array.isArray((decision as any).proposals)) {
        (decision as any).proposals = (decision as any).proposals.map((p: any) => ({ ...p, targetTeamId: normalizeTeamKey(p.targetTeamId) }));
      }
    }

    const appSettings = new ConfigManager().loadAppSettings();
    const forceApply = req.body?.forceApply === true || String(req.body?.forceApply || '').toLowerCase() === 'true';
    const willApply = (appSettings.applyChanges === true || forceApply) && decision.shouldTrade && !!decision.proposal;
    let applyResult: any = { success: false };
    let appliedAll: Array<{ index: number; success: boolean; id?: string; targetTeamId?: string }> = [];
    if (willApply) {
      // Build list of proposals to apply (primary first, then any extras)
      const list: any[] = [];
      if (decision.proposal) list.push(decision.proposal);
      if (Array.isArray((decision as any).proposals)) {
        for (const p of (decision as any).proposals) {
          // Avoid duplicating the primary if identical
          if (!decision.proposal || JSON.stringify(p) !== JSON.stringify(decision.proposal)) list.push(p);
        }
      }
      // Limit to 3 to be safe
      const toApply = list.slice(0, 3);
      for (let i = 0; i < toApply.length; i++) {
        const p = toApply[i];
        const single: any = { shouldTrade: true, reasoning: p.reasoning || decision.reasoning, confidence: decision.confidence, expectedValue: decision.expectedValue, proposal: p };
        try {
          const out = await write.applyTrade(leagueKey, teamKey, single);
          if (i === 0) applyResult = out;
          appliedAll.push({ index: i, success: !!out?.success, id: out?.id, targetTeamId: p?.targetTeamId });
        } catch {
          if (i === 0) applyResult = { success: false };
          appliedAll.push({ index: i, success: false, targetTeamId: p?.targetTeamId });
        }
      }
    }

    res.json({ ok: true, decision, applied: applyResult, appliedAll, appliedCount: appliedAll.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Pickups: ask Gemini for immediate pickup/drop moves and apply them (FA adds), not waiver claims
app.post('/api/pickups/apply', async (req, res) => {
  try {
    const s = new ConfigManager().loadAppSettings();
    const leagueKey = req.body?.leagueKey || s.leagueKey;
    const teamKey = req.body?.teamKey || s.teamKey;
    const max = Number.isFinite(Number(req.body?.max)) ? Number(req.body.max) : 3;
    if (!leagueKey || !teamKey) { res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey' }); return; }

    const cm = new ConfigManager();
    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);
    const write = new (require('../services/YahooWriteAdapter').YahooWriteAdapter)(api);
    const { GeminiClient } = require('../services/GeminiClient');
    const gemini = new GeminiClient();

    const league = await api.getLeague(leagueKey);
    const teamInfo = await api.getTeamInfo(teamKey);
    const available = await api.getFreeAgents(leagueKey, 50);
    let usingWaiversFallback = false;
    let waiversList: any[] = [];
    if (!Array.isArray(available) || available.length === 0) {
      // Fallback: if no immediate free agents, try waiver list and submit claims instead
      waiversList = await api.getWaiverWirePlayers(leagueKey, 50);
      if (!Array.isArray(waiversList) || waiversList.length === 0) {
        // Enrich error with league timing hints
        let startWeek: any = undefined, currentWeek: any = undefined, startDate: any = undefined;
        try {
          const fs = require('fs'); const path = require('path');
          const p = path.join(process.cwd(), 'logs', 'last_free_agents_raw.json');
          if (fs.existsSync(p)) {
            const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
            const meta = raw?.data?.fantasy_content?.league?.[0];
            startWeek = meta?.start_week; currentWeek = meta?.current_week; startDate = meta?.start_date;
          }
        } catch { }
        res.status(400).json({ ok: false, error: 'No available players found', hint: 'league_window', startWeek, currentWeek, startDate });
        return;
      }
      usingWaiversFallback = true;
    }

    const context = { week: league.currentWeek, season: league.season, leagueSettings: league.settings } as any;
    const myEntries = await api.getTeamRosterWithSlots(teamKey);
    const myRoster = myEntries.map((e) => e.player);
    let decision: any;
    if (!usingWaiversFallback) {
      decision = await gemini.evaluateImmediatePickups(available, myRoster, Math.max(1, Math.min(5, max)), context);
      // Ensure we don’t exceed max and strip any accidental bidAmount fields
      decision = { ...decision, claims: (decision.claims || []).slice(0, Math.max(1, Math.min(5, max))).map((c: any) => ({ playerId: c.playerId, dropPlayerId: c.dropPlayerId, priority: c.priority, reasoning: c.reasoning })) } as any;
    } else {
      // Use waiver evaluation path when no FAs
      const wdec = await gemini.evaluateWaiver(waiversList, { applyChanges: true }, Math.max(1, Math.min(5, max)), context);
      decision = { ...wdec, claims: (wdec.claims || []).slice(0, Math.max(1, Math.min(5, max))).map((c: any) => ({ playerId: c.playerId, dropPlayerId: c.dropPlayerId, priority: c.priority, reasoning: c.reasoning })) } as any;
    }

    // Pre-check: ensure adds are truly free agents when doing immediate pickups
    if (!usingWaiversFallback) {
      try {
        const faSet = new Set((available || []).map((p: any) => String(p.id)));
        const filtered = (decision.claims || []).filter((c: any) => faSet.has(String(c.playerId)));
        if (filtered.length === 0) { res.status(400).json({ ok: false, error: 'No eligible free agents to add', reason: 'not_free_agents' }); return; }
        decision.claims = filtered;
      } catch { }
    }

    // Determine if roster is full based on league rosterPositions (exclude IR slots)
    const rp: Record<string, number> = (league?.settings?.rosterPositions || {}) as any;
    const cap = Object.entries(rp).reduce((sum, [pos, cnt]) => {
      const up = String(pos || '').toUpperCase();
      if (up === 'IR') return sum; // ignore IR slots
      const n = Number(cnt);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
    const nonIrCount = myEntries.filter((e: any) => String(e.slot || '').toUpperCase() !== 'IR').length;
    let rosterFull = nonIrCount >= cap && cap > 0;
    if (String((req as any).body?.forceFull || '').toLowerCase() === 'true') rosterFull = true;

    // If roster is full, require drops; fill missing via Gemini drop-suggestion per add when possible
    if (rosterFull) {
      const { GeminiClient } = require('../services/GeminiClient');
      const gem = new GeminiClient();
      const myEntries = await api.getTeamRosterWithSlots(teamKey);
      const myRosterFull = myEntries.map((e) => e.player);
      for (let i = 0; i < (decision.claims || []).length; i++) {
        const c: any = (decision.claims as any)[i];
        if (!c.dropPlayerId) {
          try {
            const d = await gem.suggestDropForAdd(String(c.playerId), myRosterFull, context);
            if (d?.dropPlayerId && String(d.dropPlayerId) !== String(c.playerId)) {
              c.dropPlayerId = String(d.dropPlayerId);
              if (!c.reasoning) c.reasoning = d.reasoning;
            }
          } catch { }
        }
      }
      const missingIdx: number[] = [];
      (decision.claims || []).forEach((c: any, i: number) => { if (!c.dropPlayerId) missingIdx.push(i); });
      if (missingIdx.length > 0) {
        res.status(400).json({ ok: false, error: 'Roster is full; each pickup must include dropPlayerId', rosterFull: true, missingDropIndices: missingIdx, decision });
        return;
      }
    }

    // If dropPlayerId not provided, heuristically assign from bench
    try {
      if (!rosterFull) {
        const entries: Array<{ slot?: string; player: any }> = myEntries as any;
        const rosterIds = entries.map(e => String(e.player.id));
        const addSet = new Set((decision.claims || []).map((c: any) => String(c.playerId)));
        const dropCandidates = rosterIds.filter((id) => !addSet.has(String(id))).reverse();
        let idx = 0;
        decision.claims = (decision.claims || []).map((c: any) => {
          if (!c.dropPlayerId) {
            c.dropPlayerId = dropCandidates[idx++] || c.dropPlayerId;
          }
          return c;
        });
      }
    } catch { }

    // Optional explicit drop mappings from client: [{ addPlayerId, dropPlayerId }]
    try {
      const drops: Array<{ addPlayerId: string; dropPlayerId: string }> = Array.isArray((req as any).body?.drops) ? (req as any).body.drops : [];
      if (drops.length) {
        const dropMap = new Map(drops.map((d) => [String(d.addPlayerId), String(d.dropPlayerId)]));
        decision.claims = (decision.claims || []).map((c: any) => ({
          ...c,
          dropPlayerId: c.dropPlayerId || dropMap.get(String(c.playerId)),
        }));
      }
    } catch { }

    const appSettings = new ConfigManager().loadAppSettings();
    const forceApply = req.body?.forceApply === true || String(req.body?.forceApply || '').toLowerCase() === 'true';
    const willApply = (appSettings.applyChanges === true || forceApply) && decision.claims.length > 0;
    let applied = { success: false } as any;
    if (willApply) {
      // Finalize drops to ensure Yahoo accepts add/drop when roster has no space
      const entries: Array<{ slot?: string; player: any }> = await api.getTeamRosterWithSlots(teamKey);
      const rosterIds = entries.map((e) => String(e.player.id));
      const addSet = new Set((decision.claims || []).map((c: any) => String(c.playerId)));
      const dropCandidates = rosterIds.filter((id) => !addSet.has(String(id))).reverse();
      const fallbackId = rosterIds[0];
      let di = 0;
      let decisionWithDrops = {
        ...decision,
        claims: (decision.claims || []).map((c: any) => ({
          playerId: String(c.playerId),
          dropPlayerId: c.dropPlayerId || dropCandidates[di++] || fallbackId,
          priority: c.priority,
          reasoning: c.reasoning,
        })),
      } as any;
      // If client provided explicit drops mapping, enforce them here (final pass)
      try {
        const drops: Array<{ addPlayerId: string; dropPlayerId: string }> = Array.isArray((req as any).body?.drops) ? (req as any).body.drops : [];
        if (drops.length) {
          const dropMap = new Map(drops.map((d) => [String(d.addPlayerId), String(d.dropPlayerId)]));
          decisionWithDrops = {
            ...decisionWithDrops,
            claims: (decisionWithDrops.claims || []).map((c: any) => ({
              ...c,
              dropPlayerId: c.dropPlayerId || dropMap.get(String(c.playerId)),
            })),
          } as any;
        }
      } catch { }
      // Ensure every claim has a drop before applying
      const missingIdx2: number[] = [];
      (decisionWithDrops.claims || []).forEach((c: any, i: number) => { if (!c.dropPlayerId) missingIdx2.push(i); });
      if (missingIdx2.length > 0) {
        res.status(400).json({ ok: false, error: 'Missing dropPlayerId for some pickups', rosterFull, missingDropIndices: missingIdx2, decision: decisionWithDrops });
        return;
      }
      try { console.log('[Pickups] decisionWithDrops (server final):', JSON.stringify(decisionWithDrops)); } catch { }
      if (!usingWaiversFallback) {
        applied = await write.applyPickups(leagueKey, teamKey, decisionWithDrops);
      } else {
        applied = await write.applyWaivers(leagueKey, teamKey, decisionWithDrops);
      }
      decision = decisionWithDrops;
    }
    if (!applied?.success) {
      // Try to include Yahoo's last write error details for diagnostics
      try {
        const fs = require('fs'); const path = require('path');
        const p = path.join(process.cwd(), 'logs', 'last_write_error.json');
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p, 'utf8');
          const lastError = JSON.parse(raw);
          res.json({ ok: true, decision, applied, rosterFull, lastError, usingWaiversFallback });
          return;
        }
      } catch { }
    }
    res.json({ ok: true, decision, applied, rosterFull, usingWaiversFallback });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Trade block (needs/surplus)
app.get('/api/trade-block', async (req, res) => {
  try {
    const s2 = new ConfigManager().loadAppSettings();
    const leagueKey = (req.query.leagueKey as string) || s2.leagueKey;
    const teamKey = (req.query.teamKey as string) || s2.teamKey;
    const force = String(req.query.force || '0') === '1';
    if (!leagueKey || !teamKey) { res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey' }); return; }
    const cacheKey = `${leagueKey}::${teamKey}`;
    if (!force) {
      const cached = tradeBlockCache.get(cacheKey);
      if (cached && (Date.now() - cached.ts) < TRADE_BLOCK_TTL_MS) {
        res.json({ ok: true, ...cached.data, cached: true });
        return;
      }
    }
    const cm = new ConfigManager();
    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);
    const league = await api.getLeague(leagueKey);
    const entries = await api.getTeamRosterWithSlots(teamKey);
    const roster = entries.map((e) => e.player);
    let needs: string[] = [];
    let surplus: string[] = [];
    let reasoning = 'Computed via heuristic';

    if (roster.length === 0) {
      const data = { needs, surplus, reasoning: 'Roster is empty' };
      tradeBlockCache.set(cacheKey, { ts: Date.now(), data });
      res.json({ ok: true, ...data });
      return;
    }

    try {
      const client = new GeminiClient();
      const out = await client.analyzeRosterBalance(roster, league.settings);
      needs = Array.isArray(out.needs) ? out.needs : [];
      surplus = Array.isArray(out.surplus) ? out.surplus : [];
      reasoning = out.reasoning || reasoning;
    } catch (e) {
      // Fallback heuristic: compare roster counts vs starters
      const starters = league.settings?.rosterPositions || {} as any;
      const counts: Record<string, number> = {};
      for (const p of roster) { const pos = String(p.position).toUpperCase(); counts[pos] = (counts[pos] ?? 0) + 1; }
      const allPos = Array.from(new Set([...Object.keys(starters), ...Object.keys(counts)]));
      for (const pos of allPos) {
        const required = Number(starters[pos] ?? 0);
        const have = Number(counts[pos] ?? 0);
        if (have < required) needs.push(pos);
        if (have > Math.max(required, 1) + 1) surplus.push(pos);
      }
      reasoning = 'Heuristic: compared roster counts to league starters (no Gemini available).';
    }
    const data = { needs, surplus, reasoning };
    tradeBlockCache.set(cacheKey, { ts: Date.now(), data });
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Preview the exact prompt that would be sent to Gemini for lineup optimization (no API call)
app.post('/api/gemini/preview', async (req, res) => {
  try {
    const type = String(req.body?.type || 'lineup');
    const s3 = new ConfigManager().loadAppSettings();
    let leagueKey = normalizeLeagueKeyInput(req.body?.leagueKey || s3.leagueKey);
    const teamKey = normalizeTeamKeyInput(leagueKey || s3.leagueKey, req.body?.teamKey || s3.teamKey);
    const theirTeamKey = req.body?.theirTeamKey || '';
    const cm = new ConfigManager();
    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);

    // Try derive leagueKey from teamKey if missing
    if (!leagueKey && teamKey && typeof (api as any)['deriveLeagueKeyFromTeamKey'] === 'function') {
      try { leagueKey = (api as any)['deriveLeagueKeyFromTeamKey'](teamKey); } catch { }
    }

    if (type === 'lineup') {
      if (!teamKey) { res.status(400).json({ ok: false, error: 'Missing teamKey' }); return; }
      if (!leagueKey) { res.status(400).json({ ok: false, error: 'Missing leagueKey' }); return; }
      const league = await api.getLeague(leagueKey);
      const entries = await api.getTeamRosterWithSlots(teamKey);
      const roster = entries.map((e) => e.player);
      if (!league?.settings || roster.length === 0) { res.status(400).json({ ok: false, error: 'Insufficient context for lineup preview' }); return; }
      const botCfg = { applyChanges: true };
      const leagueProfile = cm.loadLeagueProfile(leagueKey);
      const { system, user } = GeminiClient.previewLineup(roster, league.settings, {
        week: league.currentWeek,
        season: league.season,
        leagueSettings: league.settings,
        leagueProfile,
        rosterWithSlots: entries,
      } as any);
      res.json({ ok: true, system, user });
      return;
    }

    if (type === 'waivers') {
      if (!leagueKey) { res.status(400).json({ ok: false, error: 'Missing leagueKey' }); return; }
      const league = await api.getLeague(leagueKey);
      let players: any[] = [];
      try { players = await api.getWaiverWirePlayers(leagueKey) as any[]; } catch (e) {
        res.status(400).json({ ok: false, error: 'Unable to fetch waivers: authentication or API error' });
        return;
      }
      if (!Array.isArray(players) || players.length === 0) {
        res.status(400).json({ ok: false, error: 'No waiver candidates available' });
        return;
      }
      const botCfg = { applyChanges: true };
      const leagueProfile = cm.loadLeagueProfile(leagueKey);
      const { system, user } = GeminiClient.previewWaivers(players as any, 100, {
        week: league.currentWeek,
        season: league.season,
        leagueSettings: league.settings,
        leagueProfile,
      } as any);
      res.json({ ok: true, system, user });
      return;
    }

    if (type === 'trade') {
      if (!leagueKey) { res.status(400).json({ ok: false, error: 'Missing leagueKey' }); return; }
      if (!teamKey) { res.status(400).json({ ok: false, error: 'Missing teamKey' }); return; }
      // Accept either explicit theirTeamKey, or numeric theirTeamNumber, or infer next-by-ring
      const theirTeamNumberRaw = req.body?.theirTeamNumber;
      const theirTeamNumber = (theirTeamNumberRaw !== undefined && theirTeamNumberRaw !== null && String(theirTeamNumberRaw).trim() !== '')
        ? parseInt(String(theirTeamNumberRaw), 10)
        : undefined;
      // Infer opponent team key when not provided, assuming sequential team numbers (default 10 teams)
      let opponentKey = theirTeamKey;
      if (!opponentKey) {
        try {
          const teamCount = parseInt(process.env.LEAGUE_TEAM_COUNT || process.env.TEAM_COUNT || '10', 10) || 10;
          const idx = String(teamKey).lastIndexOf('.t.');
          if (idx > 0) {
            const base = String(teamKey).slice(0, idx);
            const myNum = parseInt(String(teamKey).slice(idx + 3), 10);
            if (Number.isFinite(myNum)) {
              // Validate explicit theirTeamNumber if provided (1..teamCount and not equal to my team)
              if (theirTeamNumber !== undefined && Number.isFinite(theirTeamNumber)) {
                if (theirTeamNumber < 1 || theirTeamNumber > teamCount) { res.status(400).json({ ok: false, error: `Opponent team number must be between 1 and ${teamCount}` }); return; }
                if (theirTeamNumber === myNum) { res.status(400).json({ ok: false, error: 'Opponent team number cannot equal your team number' }); return; }
              }
              let oppNum: number | undefined;
              if (theirTeamNumber !== undefined && Number.isFinite(theirTeamNumber)) {
                oppNum = theirTeamNumber; // use validated 1-based number
              } else {
                // Default inference: next team in ring from my team number
                if (myNum >= 1 && myNum <= teamCount) {
                  oppNum = (myNum % teamCount) + 1; // 1-based ring
                } else {
                  oppNum = (myNum + 1) % teamCount; // 0-based ring
                }
              }
              if (oppNum !== undefined) opponentKey = `${base}.t.${oppNum}`;
            }
          }
        } catch { }
      }
      if (!opponentKey) { res.status(400).json({ ok: false, error: 'Could not infer opponent team key' }); return; }
      const league = await api.getLeague(leagueKey);
      const myEntries = await api.getTeamRosterWithSlots(teamKey);
      const theirEntries = await api.getTeamRosterWithSlots(opponentKey);
      const mine = myEntries.map((e) => e.player);
      const theirs = theirEntries.map((e) => e.player);
      if (mine.length === 0 || theirs.length === 0) { res.status(400).json({ ok: false, error: 'Insufficient roster data for trade preview' }); return; }
      const botCfg = { applyChanges: true };
      const leagueProfile = cm.loadLeagueProfile(leagueKey);
      const { system, user } = GeminiClient.previewTrade(mine as any, theirs as any, {
        week: league.currentWeek,
        season: league.season,
        leagueSettings: league.settings,
        leagueProfile,
      } as any);
      res.json({ ok: true, system, user, inferredOpponentTeamKey: opponentKey });
      return;
    }

    res.status(400).json({ ok: false, error: `Unsupported preview type: ${type}` });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.get('/api/activity', (_req, res) => {
  try {
    const logPath = path.join(process.cwd(), 'logs', 'audit.log');
    if (!fs.existsSync(logPath)) {
      res.json({ ok: true, events: [] });
      return;
    }
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    const events = lines.slice(-200).map((l) => {
      try { return JSON.parse(l); } catch { return { type: 'unknown', raw: l }; }
    });
    res.json({ ok: true, events });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.get('/api/metrics', (_req, res) => {
  try {
    const logPath = path.join(process.cwd(), 'logs', 'audit.log');
    const metrics = { decisions: 0, actions: 0, errors: 0, byType: {} as Record<string, number> };
    if (fs.existsSync(logPath)) {
      const linesAll = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
      const lines = linesAll.slice(-1000);
      for (const l of lines) {
        try {
          const obj = JSON.parse(l);
          if (obj.type === 'decision') {
            metrics.decisions += 1;
            if (obj.decision?.type) {
              const t = obj.decision.type as keyof typeof DecisionType | string;
              metrics.byType[t as string] = (metrics.byType[t as string] ?? 0) + 1;
            }
          } else if (obj.type === 'action') {
            metrics.actions += 1;
          } else if (obj.type === 'error') {
            metrics.errors += 1;
          }
        } catch { }
      }
    }
    res.json({ ok: true, metrics });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.post('/api/logs/clear', (_req, res) => {
  try {
    const dir = path.join(process.cwd(), 'logs');
    const logPath = path.join(dir, 'audit.log');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(logPath, '', 'utf8');
    res.json({ ok: true });
    sseBroadcast('activity', { cleared: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.get('/api/env', (_req, res) => {
  try {
    const s = new ConfigManager().loadAppSettings();
    try { res.setHeader('Cache-Control', 'no-store'); } catch { }
    const responseData = {
      ok: true,
      leagueKey: s.leagueKey || null,
      teamKey: s.teamKey || null,
      redirectUri: s.redirectUri || null,
      schedule: { enabled: s.scheduleEnabled, hour: s.scheduleHour, minute: s.scheduleMinute },
      features: {
        kickoffEnabled: !!s.kickoffEnabled,
        irAutomationEnabled: !!s.irAutomationEnabled,
        waiverAutomationEnabled: !!s.waiverAutomationEnabled,
        pickupsAutomationEnabled: !!s.pickupsAutomationEnabled,
        tradesAutomationEnabled: !!s.tradesAutomationEnabled,
        applyChanges: !!s.applyChanges,
      },
    };
    console.log('[/api/env] Sending response:', responseData);
    res.json(responseData);
  } catch (e) {
    console.error('[/api/env] Error:', e);
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Persist leagueKey/teamKey into app-settings (no env fallback)
app.post('/api/env', (req, res) => {
  try {
    const body = req.body || {};
    const cm = new ConfigManager();
    const s = cm.loadAppSettings();
    const leagueKey = normalizeLeagueKeyInput(body.leagueKey || s.leagueKey || '');
    const teamKey = normalizeTeamKeyInput(leagueKey, body.teamKey || s.teamKey || '');
    const redirectUri = String(body.redirectUri || s.redirectUri || '');
    const updated = cm.saveAppSettings({ ...s, leagueKey, teamKey, redirectUri });
    configureIncomingTradeWatcher(updated);
    configureTradeEvaluationScheduler(updated);
    res.json({ ok: true, leagueKey: updated.leagueKey, teamKey: updated.teamKey, redirectUri: updated.redirectUri });
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

app.post('/api/schedule', (req, res) => {
  try {
    const body = req.body || {};
    const enabled = !!body.enabled;
    const hour = body.hour !== undefined ? parseInt(String(body.hour), 10) : appSettings.scheduleHour;
    const minute = body.minute !== undefined ? parseInt(String(body.minute), 10) : appSettings.scheduleMinute;
    const leagueKey = normalizeLeagueKeyInput(body.leagueKey || appSettings.leagueKey);
    const teamKey = normalizeTeamKeyInput(leagueKey || appSettings.leagueKey, body.teamKey || appSettings.teamKey);
    if (enabled) {
      if (!leagueKey || !teamKey) {
        res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey' });
        return;
      }
      appSettings = new ConfigManager().saveAppSettings({ ...appSettings, scheduleEnabled: true, scheduleHour: hour, scheduleMinute: minute, leagueKey, teamKey });
      if (scheduler) scheduler.stop();
      const task = async () => {
        const bot = new BotController({ leagueKey: appSettings.leagueKey, teamKey: appSettings.teamKey });
        await bot.runDaily();
      };
      scheduler = new Scheduler(task, { hour: appSettings.scheduleHour, minute: appSettings.scheduleMinute, runOnStart: false });
      scheduler.start();
      appSettings = new ConfigManager().saveAppSettings({ ...appSettings, scheduleEnabled: true });
    } else {
      if (scheduler) scheduler.stop();
      scheduler = null;
      appSettings = new ConfigManager().saveAppSettings({ ...appSettings, scheduleEnabled: false });
    }
    configureIncomingTradeWatcher(appSettings);
    configureTradeEvaluationScheduler(appSettings);
    res.json({ ok: true, schedule: { enabled: appSettings.scheduleEnabled, hour: appSettings.scheduleHour, minute: appSettings.scheduleMinute } });
    sseBroadcast('schedule', { enabled: appSettings.scheduleEnabled, hour: appSettings.scheduleHour, minute: appSettings.scheduleMinute });
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

// Feature toggles: kickoff scheduler and IR automation
app.get('/api/features', (_req, res) => {
  const cm = new ConfigManager();
  const app = cm.loadAppSettings();
  try { res.setHeader('Cache-Control', 'no-store'); } catch { }
  res.json({
    ok: true, features: {
      kickoffEnabled: !!app.kickoffEnabled,
      irAutomationEnabled: !!app.irAutomationEnabled,
      waiverAutomationEnabled: !!app.waiverAutomationEnabled,
      pickupsAutomationEnabled: !!app.pickupsAutomationEnabled,
      tradesAutomationEnabled: !!app.tradesAutomationEnabled,
      tradeResponsesAutomationEnabled: !!app.tradeResponsesAutomationEnabled,
      debugYahooEnabled: !!app.debugYahooEnabled,
      applyChanges: !!app.applyChanges,
    }
  });
});

// ---------- Manual run endpoints (kickoff, IR, waivers, trades) ----------
function resolveKeys(req: express.Request): { leagueKey: string; teamKey: string } {
  const s = new ConfigManager().loadAppSettings();
  const body: any = (req as any).body || {};
  const rawLeague = String(body.leagueKey || req.query.leagueKey || s.leagueKey || '').trim();
  const rawTeam = String(body.teamKey || req.query.teamKey || s.teamKey || '').trim();
  const leagueKey = normalizeLeagueKeyInput(rawLeague);
  const teamKey = normalizeTeamKeyInput(leagueKey || s.leagueKey, rawTeam);
  return { leagueKey, teamKey };
}

app.post('/api/run/kickoff', async (req, res) => {
  try {
    const { leagueKey, teamKey } = resolveKeys(req);
    if (!leagueKey || !teamKey) { res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey' }); return; }
    const bot = new BotController({ leagueKey, teamKey });
    await bot.runKickoffCheck();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.post('/api/run/ir', async (req, res) => {
  try {
    const { leagueKey, teamKey } = resolveKeys(req);
    if (!leagueKey || !teamKey) { res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey' }); return; }
    const bot = new BotController({ leagueKey, teamKey });
    await bot.runIR();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.post('/api/run/waivers', async (req, res) => {
  try {
    const { leagueKey, teamKey } = resolveKeys(req);
    if (!leagueKey || !teamKey) { res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey' }); return; }
    const bot = new BotController({ leagueKey, teamKey });
    await bot.runWaivers();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.post('/api/run/pickups', async (req, res) => {
  try {
    const { leagueKey, teamKey } = resolveKeys(req);
    if (!leagueKey || !teamKey) { res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey' }); return; }
    const bot = new BotController({ leagueKey, teamKey });
    const result = await bot.runPickups();
    const isError = result.outcome === 'error';
    const isSuccess = result.outcome === 'applied' || result.outcome === 'dry_run';
    res.status(isError ? 500 : 200).json({ ok: isSuccess, result, error: result.error ?? (isSuccess ? undefined : result.message) });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.post('/api/run/trades', async (req, res) => {
  try {
    const { leagueKey, teamKey } = resolveKeys(req);
    if (!leagueKey || !teamKey) { res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey' }); return; }
    const bot = new BotController({ leagueKey, teamKey });
    await bot.runTrades();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.post('/api/run/trades/evaluate', async (req, res) => {
  try {
    const { leagueKey, teamKey } = resolveKeys(req);
    if (!leagueKey || !teamKey) { res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey' }); return; }
    const bot = new BotController({ leagueKey, teamKey });
    await bot.runTradeEvaluations();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.post('/api/run/trades/respond', async (req, res) => {
  try {
    const { leagueKey, teamKey } = resolveKeys(req);
    if (!leagueKey || !teamKey) { res.status(400).json({ ok: false, error: 'Missing leagueKey or teamKey' }); return; }
    const bot = new BotController({ leagueKey, teamKey });
    await bot.runTradeResponses();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

function deriveWaiverSchedule(): { day: number; hour: number; minute: number } {
  const app = new ConfigManager().loadAppSettings();
  if (app.waiverDay !== undefined || app.waiverHour !== undefined || app.waiverMinute !== undefined) {
    const day = parseInt(String(app.waiverDay ?? '2'), 10) || 2;
    const hour = parseInt(String(app.waiverHour ?? '7'), 10) || 7;
    const minute = parseInt(String(app.waiverMinute ?? '0'), 10) || 0;
    return { day, hour, minute };
  }
  // 2) League profile (config/league_setting.json)
  try {
    const cm = new ConfigManager();
    const lp: any = cm.loadLeagueProfile() as any;
    const wt = lp?.meta?.waiverTime as string | undefined;
    if (wt && typeof wt === 'string') {
      // Parse like: "Tue 7:00 AM" or "Tuesday 7:00AM" (approximate)
      const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const lower = wt.toLowerCase();
      let day = days.findIndex((d) => lower.includes(d));
      if (day < 0) day = 2; // Tue default
      const tm = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
      let hour = 7, minute = 0;
      if (tm) {
        hour = parseInt(String(tm[1]), 10);
        minute = tm[2] ? parseInt(String(tm[2]), 10) : 0;
        const ampm = tm[3];
        if (ampm === 'pm' && hour < 12) hour += 12;
        if (ampm === 'am' && hour === 12) hour = 0;
      }
      return { day, hour, minute };
    }
  } catch { }
  // 3) Default Tue 7:00
  return { day: 2, hour: 7, minute: 0 };
}

app.post('/api/features', (req, res) => {
  try {
    const body = req.body || {};
    let app = new ConfigManager().loadAppSettings();
    if (body.kickoffEnabled !== undefined) {
      const enable = !!body.kickoffEnabled;
      app = new ConfigManager().saveAppSettings({ ...app, kickoffEnabled: enable });
      // Start/stop scheduler at runtime
      try {
        const existing = (global as any).__kickoff as any;
        if (existing && existing.stop) existing.stop();
      } catch { }
      (global as any).__kickoff = null;
      if (enable) {
        const lk = app.leagueKey || '';
        const tk = app.teamKey || '';
        if (lk && tk) {
          const task = async () => { const bot = new BotController({ leagueKey: lk, teamKey: tk }); await bot.runKickoffCheck(); };
          const ko = new (require('../services/KickoffScheduler').KickoffScheduler)(task);
          ko.start();
          (global as any).__kickoff = ko;
          console.log('Kickoff scheduler enabled (pre: 30 min only).');
        }
      }
    }
    if (body.irAutomationEnabled !== undefined) {
      const enableIR = !!body.irAutomationEnabled;
      app = new ConfigManager().saveAppSettings({ ...app, irAutomationEnabled: enableIR });
    }
    if (body.waiverAutomationEnabled !== undefined) {
      const enableW = !!body.waiverAutomationEnabled;
      app = new ConfigManager().saveAppSettings({ ...app, waiverAutomationEnabled: enableW });
      // Start/stop weekly waiver scheduler
      try { const existing = (global as any).__waivers as any; if (existing && existing.stop) existing.stop(); } catch { }
      (global as any).__waivers = null;
      if (enableW) {
        const lk = app.leagueKey || '';
        const tk = app.teamKey || '';
        if (lk && tk) {
          const { day, hour, minute } = deriveWaiverSchedule();
          const task = async () => { const bot = new BotController({ leagueKey: lk, teamKey: tk }); await bot.runWaivers(); };
          const WS = require('../services/WeeklyScheduler').WeeklyScheduler;
          const ws = new WS(task, { day, hour, minute, runOnStart: false });
          ws.start();
          (global as any).__waivers = ws;
        }
      }
    }
    if (body.pickupsAutomationEnabled !== undefined) {
      const enableP = !!body.pickupsAutomationEnabled;
      app = new ConfigManager().saveAppSettings({ ...app, pickupsAutomationEnabled: enableP });
      // No scheduler; handled manually or as part of daily checks if desired
    }
    if (body.tradesAutomationEnabled !== undefined) {
      const enableT = !!body.tradesAutomationEnabled;
      app = new ConfigManager().saveAppSettings({ ...app, tradesAutomationEnabled: enableT });
      // Scheduler configuration handled below
    }
    if (body.tradeResponsesAutomationEnabled !== undefined) {
      const enableTR = !!body.tradeResponsesAutomationEnabled;
      app = new ConfigManager().saveAppSettings({ ...app, tradeResponsesAutomationEnabled: enableTR });
    }
    if (body.debugYahooEnabled !== undefined) {
      const enableD = !!body.debugYahooEnabled;
      app = new ConfigManager().saveAppSettings({ ...app, debugYahooEnabled: enableD });
    }
    if (body.applyChanges !== undefined) {
      const enableApply = !!body.applyChanges;
      app = new ConfigManager().saveAppSettings({ ...app, applyChanges: enableApply });
    }
    // Keep in-memory snapshot in sync so /api/env reflects latest values
    try { appSettings = app; } catch { }
    configureIncomingTradeWatcher(app);
    configureTradeEvaluationScheduler(app);
    res.json({
      ok: true, features: {
        kickoffEnabled: !!app.kickoffEnabled,
        irAutomationEnabled: !!app.irAutomationEnabled,
        waiverAutomationEnabled: !!app.waiverAutomationEnabled,
        pickupsAutomationEnabled: !!app.pickupsAutomationEnabled,
        tradesAutomationEnabled: !!app.tradesAutomationEnabled,
        tradeResponsesAutomationEnabled: !!app.tradeResponsesAutomationEnabled,
        debugYahooEnabled: !!app.debugYahooEnabled,
        applyChanges: !!app.applyChanges,
      }
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

app.post('/api/update-deploy', (req, res) => {
  const { exec } = require('child_process');
  const scriptPath = path.join(process.cwd(), 'scripts', 'update_deploy.sh');

  exec(`sh ${scriptPath}`, (error: any, stdout: any, stderr: any) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).json({ ok: false, error: stderr });
    }
    return res.json({ ok: true, output: stdout });
  });
});

// Deployment update endpoint - pulls latest code and restarts Docker containers
app.post('/api/deploy/update', async (req, res) => {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    console.log('[Deploy Update] Starting deployment update...');

    // Step 1: Git pull latest changes
    console.log('[Deploy Update] Pulling latest changes from origin/main...');
    const gitResult = await execAsync('git pull origin main');
    console.log('[Deploy Update] Git pull output:', gitResult.stdout);
    if (gitResult.stderr && !gitResult.stderr.includes('Already up to date')) {
      console.warn('[Deploy Update] Git pull warnings/errors:', gitResult.stderr);
    }

    // Step 2: Docker compose pull and restart
    console.log('[Deploy Update] Updating Docker containers...');
    const pullResult = await execAsync('docker compose pull');
    console.log('[Deploy Update] Docker pull output:', pullResult.stdout);
    if (pullResult.stderr) {
      console.warn('[Deploy Update] Docker pull warnings:', pullResult.stderr);
    }

    console.log('[Deploy Update] Restarting Docker containers...');
    const upResult = await execAsync('docker compose up -d --build');
    console.log('[Deploy Update] Docker up output:', upResult.stdout);
    if (upResult.stderr) {
      console.warn('[Deploy Update] Docker up warnings:', upResult.stderr);
    }

    console.log('[Deploy Update] Deployment update completed successfully');
    res.json({
      ok: true,
      message: 'Deployment updated successfully',
      details: {
        git: gitResult.stdout?.trim() || 'No changes',
        dockerPull: pullResult.stdout?.trim() || 'Completed',
        dockerUp: upResult.stdout?.trim() || 'Containers restarted'
      }
    });
  } catch (e) {
    console.error('[Deploy Update] Error during deployment update:', e);
    res.status(500).json({
      ok: false,
      error: `Deployment update failed: ${(e as Error).message}`
    });
  }
});

export function startServer(portOverride?: number): Promise<http.Server> {
  const port = portOverride ?? defaultPort;
  return new Promise((resolve, reject) => {
    const startPostHooks = () => {
      // Optionally enable kickoff checks
      try {
        const app = new ConfigManager().loadAppSettings();
        if (app.kickoffEnabled) {
          const lk = app.leagueKey || '';
          const tk = app.teamKey || '';
          if (lk && tk) {
            const task = async () => {
              const bot = new BotController({ leagueKey: lk, teamKey: tk });
              await bot.runKickoffCheck();
            };
            const ko = new KickoffScheduler(task);
            ko.start();
            (global as any).__kickoff = ko;
            console.log('Kickoff scheduler enabled (pre: 30 min only).');
          }
        }
      } catch { }
      // Enable weekly waiver scheduler on boot if configured
      try {
        const app = new ConfigManager().loadAppSettings();
        if (app.waiverAutomationEnabled) {
          const lk = app.leagueKey || '';
          const tk = app.teamKey || '';
          if (lk && tk) {
            const { day, hour, minute } = deriveWaiverSchedule();
            const task = async () => { const bot = new BotController({ leagueKey: lk, teamKey: tk }); await bot.runWaivers(); };
            const { WeeklyScheduler } = require('../services/WeeklyScheduler');
            const ws = new WeeklyScheduler(task, { day, hour, minute });
            ws.start();
            (global as any).__waivers = ws;
            console.log(`Weekly waivers scheduler enabled (day=${day}, ${hour}:${minute.toString().padStart(2, '0')}).`);
          }
        }
      } catch { }
      // Watch logs directory and emit SSE events on changes
      try {
        const logsDir = path.join(process.cwd(), 'logs');
        if (fs.existsSync(logsDir)) {
          fs.watch(logsDir, { persistent: false }, (_evt, filename) => {
            const name = String(filename || '');
            if (name === 'audit.log') sseBroadcast('activity', { file: 'audit.log', ts: Date.now() });
            else if (name === 'gemini.log') sseBroadcast('gemini', { file: 'gemini.log', ts: Date.now() });
          });
        }
      } catch { }
      // Incoming trade watcher (hourly)
      try {
        const app = new ConfigManager().loadAppSettings();
        configureIncomingTradeWatcher(app);
        configureTradeEvaluationScheduler(app);
      } catch { }
    };

    const server = http.createServer(app);
    server.listen(port, () => {
      console.log(`Web dashboard listening on http://localhost:${port}`);
      (global as any).__httpServer = server;
      startPostHooks();
      resolve(server);
    });
    server.on('error', reject);
  });
}

export default app;

if (require.main === module) {
  startServer();
}

// Serve compiled client bundle at /app.js
app.get('/app.js', (_req, res) => {
  const p = path.join(process.cwd(), 'dist', 'web', 'client.js');
  try {
    if (fs.existsSync(p)) {
      res.setHeader('Content-Type', 'application/javascript');
      res.send(fs.readFileSync(p));
    } else {
      res.status(404).send('// client bundle not built');
    }
  } catch (e) {
    res.status(500).send('// error serving client bundle');
  }
});
