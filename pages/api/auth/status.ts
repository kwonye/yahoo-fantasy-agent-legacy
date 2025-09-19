import type { NextApiRequest, NextApiResponse } from 'next';
import { isAuthorized } from '../../../src/lib/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  const authorized = isAuthorized(req.headers.cookie);
  res.status(200).json({ ok: authorized });
}
