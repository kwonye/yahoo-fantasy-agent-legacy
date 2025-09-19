import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../src/services/ConfigManager';
import { requireApiAuth } from '../../src/lib/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;

  const cm = new ConfigManager();

  if (req.method === 'GET') {
    const app = cm.loadAppSettings();
    res.json({ ok: true, config: app });
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const current = cm.loadAppSettings();
      const updated = cm.saveAppSettings({ ...current, ...(body as Record<string, unknown>) } as any);
      res.json({ ok: true, config: updated });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ ok: false, error: 'Method Not Allowed' });
}
