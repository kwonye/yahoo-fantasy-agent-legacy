import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../../../src/services/ConfigManager';
import { requireApiAuth } from '../../../../src/lib/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  try {
    const cm = new ConfigManager();
    const body = req.body || {};
    cm.saveGeminiCredentials({ apiKey: String(body.apiKey || ''), model: body.model ? String(body.model) : undefined });
    res.json({ ok: true });
  } catch (err: any) { res.status(400).json({ ok: false, error: err?.message || String(err) }); }
}
