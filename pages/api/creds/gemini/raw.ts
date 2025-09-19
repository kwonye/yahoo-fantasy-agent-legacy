import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../../../src/services/ConfigManager';
import { requireApiAuth } from '../../../../src/lib/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  try {
    const cm = new ConfigManager();
    const creds = cm.loadGeminiCredentials();
    if (!creds) {
      res.json({ ok: false, apiKey: '', model: 'gemini-2.5-pro' });
      return;
    }
    res.json({ ok: true, apiKey: creds.apiKey || '', model: creds.model || 'gemini-2.5-pro' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
