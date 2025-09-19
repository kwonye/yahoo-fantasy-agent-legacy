import type { NextApiRequest, NextApiResponse } from 'next';
import { requireApiAuth } from '../../src/lib/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;
  res.status(410).send('Gone');
}
