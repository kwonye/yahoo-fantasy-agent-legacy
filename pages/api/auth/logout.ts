import type { NextApiRequest, NextApiResponse } from 'next';
import { clearAuthCookie } from '../../../src/lib/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  clearAuthCookie(res);
  res.status(200).json({ ok: true });
}
