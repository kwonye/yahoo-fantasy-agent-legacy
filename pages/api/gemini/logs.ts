import type { NextApiRequest, NextApiResponse } from 'next';
import { GeminiLog } from '../../../src/services/GeminiLog';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    const logs = GeminiLog.readLast(100);
    res.json({ ok: true, logs });
  } catch (e: any) { res.status(500).json({ ok: false, error: e?.message || String(e) }); }
}
