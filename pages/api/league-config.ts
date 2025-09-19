import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../src/services/ConfigManager';
import { requireApiAuth } from '../../src/lib/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;
  try {
    const cm = new ConfigManager();
    const profile = cm.loadLeagueProfile();
    res.json({ ok: true, profile: profile ?? null });
  } catch (err: any) { res.status(500).json({ ok: false, error: err?.message || String(err) }); }
}
