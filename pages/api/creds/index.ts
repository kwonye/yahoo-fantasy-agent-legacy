import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../../src/services/ConfigManager';
import { requireApiAuth } from '../../../src/lib/auth';

function mask(s: string) { if (!s) return ''; return s.length <= 4 ? '*'.repeat(s.length) : `${s.slice(0,3)}***${s.slice(-2)}`; }

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  try {
    const cm = new ConfigManager();
    let yahoo = null; let gemini = null; let source = null;
    try { yahoo = cm.loadYahooCredentials(); } catch {}
    try { gemini = cm.loadGeminiCredentials(); } catch {}
    if (yahoo) source = 'store';
    const responseData = { ok: true, creds: {
      yahoo: yahoo ? { clientId: mask(yahoo.clientId), hasRefresh: !!yahoo.refreshToken, source } : null,
      gemini: gemini ? { apiKey: mask(gemini.apiKey), model: gemini.model || 'gemini-2.5-pro' } : null,
    } };
    res.json(responseData);
  } catch (err: any) { res.status(500).json({ ok: false, error: err?.message || String(err) }); }
}
