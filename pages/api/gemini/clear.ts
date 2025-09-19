import type { NextApiRequest, NextApiResponse } from 'next';
import { GeminiLog } from '../../../src/services/GeminiLog';
import { requireApiAuth } from '../../../src/lib/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;
  try { GeminiLog.clear(); res.json({ ok: true }); } catch (e: any) { res.status(500).json({ ok: false, error: e?.message || String(e) }); }
}
