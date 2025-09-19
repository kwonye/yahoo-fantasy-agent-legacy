import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../src/services/ConfigManager';
import { requireApiAuth } from '../../src/lib/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;

  try {
    const cm = new ConfigManager();

    if (req.method === 'GET') {
      const app = cm.loadAppSettings();
      res.json({ ok: true, ...app });
      return;
    }

    if (req.method === 'POST') {
      const body = (req.body as Record<string, unknown>) || {};
      const current = cm.loadAppSettings();

      const coerceBoolean = (value: unknown, fallback: boolean) =>
        typeof value === 'boolean' ? value : fallback;

      const coerceNumber = (value: unknown, fallback: number) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
      };

      const updated = cm.saveAppSettings({
        ...current,
        leagueKey: body.leagueKey ?? current.leagueKey,
        teamKey: body.teamKey ?? current.teamKey,
        redirectUri: body.redirectUri ?? current.redirectUri,
        scheduleEnabled: coerceBoolean(body.scheduleEnabled, current.scheduleEnabled),
        scheduleHour: coerceNumber(body.scheduleHour, current.scheduleHour),
        scheduleMinute: coerceNumber(body.scheduleMinute, current.scheduleMinute),
        waiverDay: body.waiverDay !== undefined ? coerceNumber(body.waiverDay, current.waiverDay ?? 2) : current.waiverDay,
        waiverHour: body.waiverHour !== undefined ? coerceNumber(body.waiverHour, current.waiverHour ?? 7) : current.waiverHour,
        waiverMinute: body.waiverMinute !== undefined ? coerceNumber(body.waiverMinute, current.waiverMinute ?? 0) : current.waiverMinute,
        kickoffEnabled: coerceBoolean(body.kickoffEnabled, current.kickoffEnabled),
        irAutomationEnabled: coerceBoolean(body.irAutomationEnabled, current.irAutomationEnabled),
        waiverAutomationEnabled: coerceBoolean(body.waiverAutomationEnabled, current.waiverAutomationEnabled),
        pickupsAutomationEnabled: coerceBoolean(body.pickupsAutomationEnabled, current.pickupsAutomationEnabled),
        tradesAutomationEnabled: coerceBoolean(body.tradesAutomationEnabled, current.tradesAutomationEnabled),
        debugYahooEnabled: coerceBoolean(body.debugYahooEnabled, current.debugYahooEnabled),
        applyChanges: coerceBoolean(body.applyChanges, current.applyChanges),
      });

      res.json({ ok: true, ...updated });
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
