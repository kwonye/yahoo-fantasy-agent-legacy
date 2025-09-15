import type { NextApiRequest, NextApiResponse } from 'next';
import { GeminiLog } from '../../../src/services/GeminiLog';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  try { GeminiLog.clear(); res.json({ ok: true }); } catch (e: any) { res.status(500).json({ ok: false, error: e?.message || String(e) }); }
}
