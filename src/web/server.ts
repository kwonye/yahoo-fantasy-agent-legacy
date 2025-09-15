import express from 'express';
import http from 'http';
import path from 'path';
import dotenv from 'dotenv';
import { ConfigManager } from '../services/ConfigManager';

dotenv.config();

const app = express();
app.set('trust proxy', true);
const defaultPort = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

let appSettings: any = (() => {
  try { return new ConfigManager().loadAppSettings(); } catch { return {}; }
})();

function mask(s?: string) {
  if (!s) return '';
  return s.length <= 4 ? '*'.repeat(s.length) : `${s.slice(0, 3)}***${s.slice(-2)}`;
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/config', (_req, res) => {
  try {
    const cm = new ConfigManager();
    const cfg = cm.loadAppSettings();
    res.json({ ok: true, config: cfg });
  } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
});

app.post('/api/config', (req, res) => {
  try {
    const body = req.body || {};
    const cm = new ConfigManager();
    const current = cm.loadAppSettings();
    // Merge UI-managed bot settings under `bot` and preserve unknown keys
    const incomingBot = body.bot || body;
    const merged = { ...current, ...(incomingBot || {}) } as any;
    const saved = cm.saveAppSettings(merged);
    try { appSettings = saved; } catch {}
    res.json({ ok: true, config: saved });
  } catch (e) { res.status(400).json({ ok: false, error: (e as Error).message }); }
});

app.post('/api/creds/yahoo', (req, res) => {
  try {
    const { clientId, clientSecret } = req.body || {};
    if (!clientId || !clientSecret) { res.status(400).json({ ok: false, error: 'missing' }); return; }
    const cm = new ConfigManager();
    cm.saveYahooCredentials({ clientId: String(clientId), clientSecret: String(clientSecret), accessToken: undefined, refreshToken: undefined });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
});

app.post('/api/creds/gemini', (req, res) => {
  try {
    const { apiKey } = req.body || {};
    if (!apiKey) { res.status(400).json({ ok: false, error: 'missing' }); return; }
    const cm = new ConfigManager();
    cm.saveGeminiCredentials({ apiKey: String(apiKey) });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
});

app.get('/api/creds', (_req, res) => {
  try {
    const cm = new ConfigManager();
    let yahoo: any = null; let gemini: any = null;
    try { yahoo = cm.loadYahooCredentials(); } catch {}
    try { gemini = cm.loadGeminiCredentials(); } catch {}
    res.json({ ok: true, creds: {
      yahoo: yahoo ? { clientId: mask(yahoo.clientId), hasRefresh: !!yahoo.refreshToken } : null,
      gemini: gemini ? { apiKey: mask(gemini.apiKey), model: gemini.model || 'gemini-2.5-pro' } : null,
    }});
  } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
});

app.get('/api/env', (_req, res) => {
  try {
    const cm = new ConfigManager();
    const s = appSettings || cm.loadAppSettings();
    res.setHeader('Cache-Control', 'no-store');
    const leagueKey = process.env.LEAGUE_KEY || s.leagueKey || null;
    const teamKey = process.env.TEAM_KEY || s.teamKey || null;
    res.json({ ok: true, leagueKey, teamKey, schedule: { enabled: !!s.scheduleEnabled, hour: s.scheduleHour, minute: s.scheduleMinute } });
  } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
});

app.post('/api/schedule', (req, res) => {
  try {
    const body = req.body || {};
    const cm = new ConfigManager();
    const s = cm.loadAppSettings();
    const updated = cm.saveAppSettings({ ...s, scheduleEnabled: !!body.enabled, scheduleHour: typeof body.hour === 'number' ? body.hour : s.scheduleHour, scheduleMinute: typeof body.minute === 'number' ? body.minute : s.scheduleMinute });
    try { appSettings = updated; } catch {}
    res.json({ ok: true, schedule: { enabled: updated.scheduleEnabled, hour: updated.scheduleHour, minute: updated.scheduleMinute } });
  } catch (e) { res.status(400).json({ ok: false, error: (e as Error).message }); }
});

export function startServer(portOverride?: number): Promise<http.Server> {
  const port = portOverride ?? defaultPort;
  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve(server));
  });
}

if (require.main === module) startServer();
