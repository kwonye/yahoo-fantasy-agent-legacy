import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../src/services/ConfigManager';
import { requireApiAuth } from '../../src/lib/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;

  try {
    const cm = new ConfigManager();

    if (req.method === 'GET') {
      const profile = cm.loadLeagueProfile();
      res.json({ ok: true, profile: profile ?? null });
      return;
    }

    if (req.method === 'POST') {
      try {
        const body = req.body ?? {};
        const saved = cm.saveLeagueProfile(body as any);
        res.json({ ok: true, profile: saved });
      } catch (err: any) {
        res.status(400).json({ ok: false, error: err?.message || String(err) });
      }
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
