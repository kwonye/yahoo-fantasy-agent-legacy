import type { NextApiRequest, NextApiResponse } from 'next';
import { requireApiAuth } from '../../src/lib/auth';
import { readAuditLog } from '../../src/lib/audit';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const limit = Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 500;
  const events = readAuditLog(limit > 0 ? limit : 500);
  res.json({ ok: true, events });
}
