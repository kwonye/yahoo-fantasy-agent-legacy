import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../../src/services/ConfigManager';
import { requireApiAuth } from '../../../src/lib/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;

  const cm = new ConfigManager();

  if (req.method === 'GET') {
    const settings = cm.loadAppSettings();
    res.json({
      ok: true,
      schedule: {
        enabled: !!settings.scheduleEnabled,
        hour: settings.scheduleHour,
        minute: settings.scheduleMinute,
        waiverDay: settings.waiverDay ?? 2,
        waiverHour: settings.waiverHour ?? 7,
        waiverMinute: settings.waiverMinute ?? 0,
      },
    });
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = (req.body as Record<string, unknown>) || {};
      const current = cm.loadAppSettings();
      const toNumber = (value: unknown, fallback: number) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
      };
      const updated = cm.saveAppSettings({
        ...current,
        leagueKey: body.leagueKey ?? current.leagueKey,
        teamKey: body.teamKey ?? current.teamKey,
        scheduleEnabled: body.enabled !== undefined ? Boolean(body.enabled) : current.scheduleEnabled,
        scheduleHour: toNumber(body.hour, current.scheduleHour ?? 9),
        scheduleMinute: toNumber(body.minute, current.scheduleMinute ?? 0),
        waiverDay: body.waiverDay !== undefined ? toNumber(body.waiverDay, current.waiverDay ?? 2) : current.waiverDay,
        waiverHour: body.waiverHour !== undefined ? toNumber(body.waiverHour, current.waiverHour ?? 7) : current.waiverHour,
        waiverMinute: body.waiverMinute !== undefined ? toNumber(body.waiverMinute, current.waiverMinute ?? 0) : current.waiverMinute,
      } as any);
      res.json({ ok: true, schedule: {
        enabled: !!updated.scheduleEnabled,
        hour: updated.scheduleHour,
        minute: updated.scheduleMinute,
        waiverDay: updated.waiverDay ?? 2,
        waiverHour: updated.waiverHour ?? 7,
        waiverMinute: updated.waiverMinute ?? 0,
      }});
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ ok: false, error: 'Method Not Allowed' });
}
