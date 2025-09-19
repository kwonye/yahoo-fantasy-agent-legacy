import type { NextApiRequest, NextApiResponse } from 'next';
import { requireApiAuth } from '../../src/lib/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  res.json({ status: 'ok', time: new Date().toISOString() });
}
