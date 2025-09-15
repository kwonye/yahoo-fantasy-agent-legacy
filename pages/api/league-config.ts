import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../src/services/ConfigManager';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    const cm = new ConfigManager();
    const profile = cm.loadLeagueProfile();
    res.json({ ok: true, profile: profile ?? null });
  } catch (err: any) { res.status(500).json({ ok: false, error: err?.message || String(err) }); }
}
