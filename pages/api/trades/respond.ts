import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../../src/services/ConfigManager';
import { YahooOAuthClient } from '../../../src/services/YahooOAuthClient';
import { YahooApiService } from '../../../src/services/YahooApiService';
import { YahooWriteAdapter } from '../../../src/services/YahooWriteAdapter';
import { requireApiAuth } from '../../../src/lib/auth';
import { normalizeLeagueKeyInput } from '../../../src/lib/yahooKeys';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  try {
    const cm = new ConfigManager();
    const settings = cm.loadAppSettings();
    const leagueKey = normalizeLeagueKeyInput(req.body?.leagueKey || settings.leagueKey || '');
    const tradeId = String(req.body?.tradeId || '').trim();
    const accept = Boolean(req.body?.accept);

    if (!leagueKey || !tradeId) {
      res.status(400).json({ ok: false, error: 'Missing leagueKey or tradeId' });
      return;
    }

    const oauth = new YahooOAuthClient(cm);
    const api = new YahooApiService(oauth);
    const writer = new YahooWriteAdapter(api);
    const result = await writer.applyTradeResponse(leagueKey, tradeId, accept);
    if (!result.success) {
      res.status(500).json({ ok: false, error: 'Yahoo trade response failed' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
