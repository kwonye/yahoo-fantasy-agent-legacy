import type { NextApiRequest, NextApiResponse } from 'next';
import { isPasswordConfigured, setAuthCookie } from '../../../src/lib/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  if (!isPasswordConfigured()) {
    res.status(500).json({ ok: false, error: 'Dashboard password is not configured' });
    return;
  }

  const { password } = (req.body as { password?: string }) ?? {};
  if (!password || password !== process.env.DASHBOARD_PASSWORD) {
    res.status(401).json({ ok: false, error: 'Invalid password' });
    return;
  }

  setAuthCookie(res);
  res.status(200).json({ ok: true });
}
