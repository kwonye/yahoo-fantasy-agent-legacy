import type { NextApiRequest, NextApiResponse } from 'next';
import { requireApiAuth } from '../../src/lib/auth';
import { readAuditLog, computeAuditMetrics } from '../../src/lib/audit';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  const events = readAuditLog(1000);
  const metrics = computeAuditMetrics(events);
  const latest = events.length ? events[events.length - 1] : null;

  res.json({ ok: true, metrics: { ...metrics, latestTs: latest?.ts ?? null } });
}
