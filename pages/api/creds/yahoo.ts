import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../../src/services/ConfigManager';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const cm = new ConfigManager();
    const body = req.body || {};
    const existing = (() => { try { return cm.loadYahooCredentials(); } catch { return null; } })();
    const next = { clientId: String(body.clientId || ''), clientSecret: String(body.clientSecret || ''), accessToken: body.accessToken, refreshToken: body.refreshToken };
    if (existing && existing.clientId && String(existing.clientId) !== next.clientId) {
      try { cm.deleteYahooAuthToken(); } catch {}
    }
    cm.saveYahooCredentials(next);
    res.json({ ok: true });
  } catch (e: any) { res.status(400).json({ ok: false, error: e?.message || String(e) }); }
}
