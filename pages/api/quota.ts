import type { NextApiRequest, NextApiResponse } from 'next';
import { requireApiAuth } from '../../src/lib/auth';
import { getQuotaSnapshot } from '../../src/lib/quota';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;

  res.status(200).json(getQuotaSnapshot());
}
