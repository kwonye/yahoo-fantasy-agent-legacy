import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { DecisionType } from '../models/Common';
import { BotController } from '../controllers/BotController';
import { Scheduler } from '../services/Scheduler';
import { YahooOAuthClient } from '../services/YahooOAuthClient';
import { YahooApiService } from '../services/YahooApiService';
import { GeminiClient } from '../services/GeminiClient';
import { GeminiLog } from '../services/GeminiLog';
import { KickoffScheduler } from '../services/KickoffScheduler';
import { ConfigManager } from '../services/ConfigManager';

dotenv.config();

const app = express();
const defaultPort = parseInt(process.env.PORT || '3000', 10);
let scheduler: Scheduler | null = null;
// runtime state is sourced from AppSettings
const cmInit = new ConfigManager();
let appSettings = cmInit.loadAppSettings();
// Simple cache for expensive computations (trade block)
const tradeBlockCache = new Map<string, { ts: number; data: { needs: string[]; surplus: string[]; reasoning: string } }>();
const TRADE_BLOCK_TTL_MS = 2 * 60 * 1000;

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

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
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
    try { res.write(': ping\n\n'); } catch {}
  }, 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

app.get('/api/config', (_req, res) => {
  try {
    const cm = new ConfigManager();
    const cfg = cm.getBotConfig();
    res.json({ ok: true, config: cfg });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Gemini quota status
app.get('/api/quota', (_req, res) => {
  try {
    const { GeminiQuota } = require('../services/GeminiQuota');
    const q = new GeminiQuota();
    // Read internals by getting remaining and limit; date is implied by file contents
    const remaining = q.getRemaining();
    const limit = q.getLimit();
    res.json({ ok: true, limit, remaining, date: new Date().toISOString().slice(0,10) });
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
            const days = ['sun','mon','tue','wed','thu','fri','sat'];
            const lower = wt.toLowerCase();
            let d = days.findIndex((x) => lower.includes(x)); if (d < 0) d = 2;
            const tm = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
            let h = 7, m = 0; if (tm) { h = parseInt(String(tm[1]), 10); m = tm[2] ? parseInt(String(tm[2]), 10) : 0; const ap = tm[3]; if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; }
            day = d; hour = h; minute = m; source = 'league_profile';
          }
        } catch {}
      }
      const next = (() => { const now = new Date(); const d = new Date(now); const delta = (day - d.getDay() + 7) % 7; d.setDate(d.getDate() + delta); d.setHours(hour, minute, 0, 0); if (d <= now) d.setDate(d.getDate() + 7); return d; })();
      waiver = { enabled: true, day, hour, minute, nextRunISO: next.toISOString(), source };
    }
    // Kickoff pre-checks schedule (next few occurrences)
    const kickoffEnabled = !!app.kickoffEnabled;
    const preMinutes = [90, 60, 30];
    const windows = [
      { dow: 4, hh: 20, mm: 20 },
      { dow: 0, hh: 13, mm: 0 },
      { dow: 0, hh: 16, mm: 25 },
      { dow: 0, hh: 20, mm: 20 },
      { dow: 1, hh: 20, mm: 15 },
    ];
    const upcoming: Array<{ runAtISO: string; preMinutes: number; window: { dow: number; hh: number; mm: number } }> = [];
    if (kickoffEnabled) {
      const now = Date.now();
      const nextDowTime = (dow: number, hh: number, mm: number) => {
        const d = new Date();
        const delta = (dow - d.getDay() + 7) % 7;
        const n = new Date(d);
        n.setDate(d.getDate() + delta);
        n.setHours(hh, mm, 0, 0);
        if (n.getTime() <= Date.now()) n.setDate(n.getDate() + 7);
        return n;
      };
      for (const w of windows) {
        const kickoff = nextDowTime(w.dow, w.hh, w.mm).getTime();
        for (const pre of preMinutes) {
          const runAt = new Date(kickoff - pre * 60000);
          if (runAt.getTime() > now) upcoming.push({ runAtISO: runAt.toISOString(), preMinutes: pre, window: w });
        }
      }
      // Sort by soonest and keep next ~10
      upcoming.sort((a, b) => new Date(a.runAtISO).getTime() - new Date(b.runAtISO).getTime());
    }
    res.json({ ok: true, waiver, kickoff: { enabled: kickoffEnabled, preMinutes, upcoming } });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.post('/api/config', (req, res) => {
  try {
    const cm = new ConfigManager();
    const saved = cm.savePreferences(req.body?.bot ?? {});
    res.json({ ok: true, config: saved });
    sseBroadcast('config', { ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
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
    try { yahoo = cm.loadYahooCredentials(); } catch {}
    try { gemini = cm.loadGeminiCredentials(); } catch {}
    if (!yahoo) {
      try { const envY = cm.getYahooEnvCredentials(); yahoo = envY; } catch {}
    }
    if (!gemini) {
      try { const envG = cm.getEnvCredentials().gemini; gemini = envG; } catch {}
    }
    res.json({ ok: true, creds: {
      yahoo: yahoo ? { clientId: mask(yahoo.clientId), hasRefresh: !!yahoo.refreshToken } : null,
      gemini: gemini ? { apiKey: mask(gemini.apiKey) } : null,
    }});
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.post('/api/creds/yahoo', (req, res) => {
  try {
    const cm = new ConfigManager();
    const body = req.body || {};
    cm.saveYahooCredentials({
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
    });
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
    cm.saveGeminiCredentials({ apiKey: body.apiKey });
    res.json({ ok: true });
    sseBroadcast('creds', { source: 'gemini' });
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

app.post('/api/bot/run', async (req, res) => {
  const leagueKey = req.body?.leagueKey || process.env.LEAGUE_KEY;
  const teamKey = req.body?.teamKey || process.env.TEAM_KEY;
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
  const teamKey = (req.query.teamKey as string) || process.env.TEAM_KEY;
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
  const leagueKey = (req.query.leagueKey as string) || process.env.LEAGUE_KEY;
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
            name === 'bot-config.json' ? 3 :
            2;
          files.sort((a: string, b: string) => preferredOrder(a) - preferredOrder(b));
          const chosen = files[0];
          if (!chosen) return null;
          const chosenPath = pathMod.join(dir, chosen);
          const raw = fsMod.readFileSync(chosenPath, 'utf8');
          const obj = JSON.parse(raw);
          // Normalize to canonical path for future
          const target = pathMod.join(dir, 'league_setting.json');
          try { fsMod.writeFileSync(target, JSON.stringify(obj, null, 2), 'utf8'); } catch {}
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
      } catch {}
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
    let hasKey = !!process.env.GEMINI_API_KEY;
    if (!hasKey) {
      try { const g = cm.loadGeminiCredentials(); hasKey = !!g?.apiKey; } catch {}
    }
    if (!hasKey) { res.status(400).json({ ok: false, error: 'GEMINI_API_KEY missing' }); return; }
    if (!prompt) { res.status(400).json({ ok: false, error: 'Prompt is required' }); return; }
    const client = new GeminiClient();
    const text = await client.generate(system, prompt);
    res.json({ ok: true, response: text });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Trades: incoming list
app.get('/api/trades/incoming', async (req, res) => {
  try {
    const leagueKey = (req.query.leagueKey as string) || process.env.LEAGUE_KEY;
    const teamKey = (req.query.teamKey as string) || process.env.TEAM_KEY;
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
    // Filter: only proposed trades involving my team number
    const myTeamNum = (() => {
      const tk = teamKey || '';
      const idx = tk.lastIndexOf('.t.');
      if (idx > 0) return tk.slice(idx + 3);
      return '';
    })();
    const involvesTeam = (t: any): boolean => {
      const num = myTeamNum;
      if (!num) return true; // if unknown, don't filter out
      const endsWithNum = (s?: string) => !!s && (s.endsWith('.t.' + num) || s === teamKey);
      // Check normalized lists
      if (Array.isArray(t.teamKeys) && t.teamKeys.some((k: string) => endsWithNum(k))) return true;
      if (Array.isArray(t.teamIds) && t.teamIds.some((id: string) => id === String(num))) return true;
      if (Array.isArray(t.moves) && t.moves.some((m: any) => endsWithNum(m?.source) || endsWithNum(m?.destination))) return true;
      // Fallback: deep scan raw for strings that end with .t.{num}
      const seen = new Set<any>();
      const scan = (n: any): boolean => {
        if (!n || typeof n !== 'object') return false;
        if (seen.has(n)) return false; seen.add(n);
        for (const v of Object.values(n)) {
          if (typeof v === 'string' && endsWithNum(v)) return true;
          if (typeof v === 'object' && scan(v)) return true;
          if (Array.isArray(v)) { for (const sv of v) { if (typeof sv === 'string' && endsWithNum(sv)) return true; if (typeof sv === 'object' && scan(sv)) return true; } }
        }
        return false;
      };
      try { if (t.raw && scan(t.raw)) return true; } catch {}
      return false;
    };
    const isProposed = (t: any): boolean => {
      const s = String(t?.status || '').toLowerCase();
      if (s.includes('propos')) return true;
      // fallback: attempt raw lookup
      try {
        // deep scan for any 'status' value containing 'propos'
        const seen = new Set<any>();
        const scan = (n: any): boolean => {
          if (!n || typeof n !== 'object') return false;
          if (seen.has(n)) return false; seen.add(n);
          for (const [k, v] of Object.entries(n)) {
            if (k.toLowerCase() === 'status' && typeof v === 'string' && v.toLowerCase().includes('propos')) return true;
            if (typeof v === 'object' && scan(v)) return true;
          }
          return false;
        };
        if (t.raw && scan(t.raw)) return true;
      } catch {}
      return false;
    };
    // Deduplicate by id
    const dedup = (() => {
      const seen = new Set<string>();
      const out: any[] = [];
      for (const t of (tradesAll || [])) {
        const id = String(t?.id || '');
        const key = id || JSON.stringify({ moves: t?.moves || [], teamKeys: t?.teamKeys || [] });
        if (seen.has(key)) continue; seen.add(key); out.push(t);
      }
      return out;
    })();
    // Filter to trades involving my team (when teamKey is known)
    const involvingMine = dedup.filter(involvesTeam);
    // Filter to pending/proposed where possible
    const pending = involvingMine.filter(isProposed);
    const trades = pending.length ? pending : involvingMine.length ? involvingMine : dedup;
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
    } catch {}
    res.json({ ok: true, trades, teamKeyUsed: teamKey || null, debug: debug ? { tried: dbg.tried } : undefined });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Dump all transactions (normalized) for diagnostics
app.get('/api/trades/dump', async (req, res) => {
  try {
    const leagueKey = (req.query.leagueKey as string) || process.env.LEAGUE_KEY;
    const teamKey = (req.query.teamKey as string) || process.env.TEAM_KEY;
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
    const leagueKey = req.body?.leagueKey || process.env.LEAGUE_KEY;
    const teamKey = req.body?.teamKey || process.env.TEAM_KEY;
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
    const leagueProfile = new ConfigManager().loadLeagueProfile(leagueKey);
    // Needs/surplus analysis
    const gemini = new (require('../services/GeminiClient').GeminiClient)();
    let needs: string[] = [];
    let surplus: string[] = [];
    try {
      const ns = await gemini.analyzeRosterBalance(myRoster, league.settings);
      needs = Array.isArray(ns.needs) ? ns.needs : [];
      surplus = Array.isArray(ns.surplus) ? ns.surplus : [];
    } catch {}
    const decision = await gemini.evaluateIncomingTradeOffer(myRoster, league.settings, needs, surplus, tx.moves, String(teamKey), leagueProfile);
    res.json({ ok: true, tradeId, decision, needs, surplus });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Trades: respond (accept/decline)
app.post('/api/trades/respond', async (req, res) => {
  try {
    const leagueKey = req.body?.leagueKey || process.env.LEAGUE_KEY;
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
    const leagueKey = (req.query.leagueKey as string) || process.env.LEAGUE_KEY;
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

// Trade block (needs/surplus)
app.get('/api/trade-block', async (req, res) => {
  try {
    const leagueKey = (req.query.leagueKey as string) || process.env.LEAGUE_KEY;
    const teamKey = (req.query.teamKey as string) || process.env.TEAM_KEY;
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
    let leagueKey = req.body?.leagueKey || process.env.LEAGUE_KEY;
    const teamKey = req.body?.teamKey || process.env.TEAM_KEY;
    const theirTeamKey = req.body?.theirTeamKey || '';
    const cm = new ConfigManager();
    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);

    // Try derive leagueKey from teamKey if missing
    if (!leagueKey && teamKey && typeof (api as any)['deriveLeagueKeyFromTeamKey'] === 'function') {
      try { leagueKey = (api as any)['deriveLeagueKeyFromTeamKey'](teamKey); } catch {}
    }

    if (type === 'lineup') {
      if (!teamKey) { res.status(400).json({ ok: false, error: 'Missing teamKey' }); return; }
      if (!leagueKey) { res.status(400).json({ ok: false, error: 'Missing leagueKey' }); return; }
      const league = await api.getLeague(leagueKey);
      const entries = await api.getTeamRosterWithSlots(teamKey);
      const roster = entries.map((e) => e.player);
      if (!league?.settings || roster.length === 0) { res.status(400).json({ ok: false, error: 'Insufficient context for lineup preview' }); return; }
      const botCfg = cm.getBotConfig();
      const leagueProfile = cm.loadLeagueProfile(leagueKey);
      const { system, user } = GeminiClient.previewLineup(roster, league.settings, botCfg, {
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
      const botCfg = cm.getBotConfig();
      const leagueProfile = cm.loadLeagueProfile(leagueKey);
      const { system, user } = GeminiClient.previewWaivers(players as any, botCfg, botCfg.maxWaiverClaims, {
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
        } catch {}
      }
      if (!opponentKey) { res.status(400).json({ ok: false, error: 'Could not infer opponent team key' }); return; }
      const league = await api.getLeague(leagueKey);
      const myEntries = await api.getTeamRosterWithSlots(teamKey);
      const theirEntries = await api.getTeamRosterWithSlots(opponentKey);
      const mine = myEntries.map((e) => e.player);
      const theirs = theirEntries.map((e) => e.player);
      if (mine.length === 0 || theirs.length === 0) { res.status(400).json({ ok: false, error: 'Insufficient roster data for trade preview' }); return; }
      const botCfg = cm.getBotConfig();
      const leagueProfile = cm.loadLeagueProfile(leagueKey);
      const { system, user } = GeminiClient.previewTrade(mine as any, theirs as any, botCfg, {
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
        } catch {}
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
  res.json({
    ok: true,
    leagueKey: appSettings.leagueKey || null,
    teamKey: appSettings.teamKey || null,
    schedule: {
      enabled: appSettings.scheduleEnabled,
      hour: appSettings.scheduleHour,
      minute: appSettings.scheduleMinute,
    },
    features: {
      kickoffEnabled: !!appSettings.kickoffEnabled,
      irAutomationEnabled: !!appSettings.irAutomationEnabled,
      waiverAutomationEnabled: !!appSettings.waiverAutomationEnabled,
      tradesAutomationEnabled: !!appSettings.tradesAutomationEnabled,
    },
  });
});

app.post('/api/schedule', (req, res) => {
  try {
    const body = req.body || {};
    const enabled = !!body.enabled;
    const hour = body.hour !== undefined ? parseInt(String(body.hour), 10) : appSettings.scheduleHour;
    const minute = body.minute !== undefined ? parseInt(String(body.minute), 10) : appSettings.scheduleMinute;
    const leagueKey = body.leagueKey || appSettings.leagueKey;
    const teamKey = body.teamKey || appSettings.teamKey;
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
  res.json({ ok: true, features: {
    kickoffEnabled: !!app.kickoffEnabled,
    irAutomationEnabled: !!app.irAutomationEnabled,
    waiverAutomationEnabled: !!app.waiverAutomationEnabled,
    tradesAutomationEnabled: !!app.tradesAutomationEnabled,
  }});
});

function deriveWaiverSchedule(): { day: number; hour: number; minute: number } {
  // 1) Env overrides
  const envDay = process.env.WAIVER_DAY; const envHour = process.env.WAIVER_HOUR; const envMin = process.env.WAIVER_MINUTE;
  const app = new ConfigManager().loadAppSettings();
  if (app.waiverDay !== undefined || app.waiverHour !== undefined || app.waiverMinute !== undefined) {
    const day = parseInt(String(app.waiverDay ?? '2'), 10) || 2;
    const hour = parseInt(String(app.waiverHour ?? '7'), 10) || 7;
    const minute = parseInt(String(app.waiverMinute ?? '0'), 10) || 0;
    return { day, hour, minute };
  }
  if (envDay !== undefined || envHour !== undefined || envMin !== undefined) {
    const day = parseInt(String(envDay ?? '2'), 10) || 2;
    const hour = parseInt(String(envHour ?? '7'), 10) || 7;
    const minute = parseInt(String(envMin ?? '0'), 10) || 0;
    return { day, hour, minute };
  }
  // 2) League profile (config/league_setting.json)
  try {
    const cm = new ConfigManager();
    const lp: any = cm.loadLeagueProfile() as any;
    const wt = lp?.meta?.waiverTime as string | undefined;
    if (wt && typeof wt === 'string') {
      // Parse like: "Tue 7:00 AM" or "Tuesday 7:00AM" (approximate)
      const days = ['sun','mon','tue','wed','thu','fri','sat'];
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
  } catch {}
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
      } catch {}
      (global as any).__kickoff = null;
      if (enable) {
        const lk = app.leagueKey || '';
        const tk = app.teamKey || '';
        if (lk && tk) {
          const task = async () => { const bot = new BotController({ leagueKey: lk, teamKey: tk }); await bot.runKickoffCheck(); };
          const ko = new (require('../services/KickoffScheduler').KickoffScheduler)(task);
          ko.start();
          (global as any).__kickoff = ko;
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
      try { const existing = (global as any).__waivers as any; if (existing && existing.stop) existing.stop(); } catch {}
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
    if (body.tradesAutomationEnabled !== undefined) {
      const enableT = !!body.tradesAutomationEnabled;
      app = new ConfigManager().saveAppSettings({ ...app, tradesAutomationEnabled: enableT });
      // No dedicated scheduler; handled in daily runs
    }
    res.json({ ok: true, features: {
      kickoffEnabled: !!app.kickoffEnabled,
      irAutomationEnabled: !!app.irAutomationEnabled,
      waiverAutomationEnabled: !!app.waiverAutomationEnabled,
      tradesAutomationEnabled: !!app.tradesAutomationEnabled,
    }});
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

export function startServer(portOverride?: number): Promise<http.Server> {
  const port = portOverride ?? defaultPort;
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Web dashboard listening on http://localhost:${port}`);
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
            console.log('Kickoff scheduler enabled (pre: 90/60/30 min).');
          }
        }
      } catch {}
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
            console.log(`Weekly waivers scheduler enabled (day=${day}, ${hour}:${minute.toString().padStart(2,'0')}).`);
          }
        }
      } catch {}
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
      } catch {}
      resolve(server);
  });
});
}

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
