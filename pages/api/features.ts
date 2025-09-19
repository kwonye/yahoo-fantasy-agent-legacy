import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../src/services/ConfigManager';
import { requireApiAuth } from '../../src/lib/auth';

const FEATURE_KEYS = [
  'kickoffEnabled',
  'irAutomationEnabled',
  'waiverAutomationEnabled',
  'pickupsAutomationEnabled',
  'tradesAutomationEnabled',
  'debugYahooEnabled',
  'applyChanges',
] as const;

type FeatureKey = typeof FEATURE_KEYS[number];

type Features = Record<FeatureKey, boolean>;

function pickFeatures(settings: Record<string, unknown>): Features {
  const result = {} as Features;
  for (const key of FEATURE_KEYS) {
    result[key] = Boolean(settings?.[key]);
  }
  return result;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;

  try {
    const cm = new ConfigManager();

    if (req.method === 'GET') {
      const settings = cm.loadAppSettings();
      res.json({ ok: true, features: pickFeatures(settings) });
      return;
    }

    if (req.method === 'POST') {
      const settings = cm.loadAppSettings();
      const next = { ...settings } as Record<string, unknown>;
      for (const key of FEATURE_KEYS) {
        if (key in (req.body as Record<string, unknown>)) {
          next[key] = Boolean((req.body as Record<string, unknown>)[key]);
        }
      }
      const saved = cm.saveAppSettings(next as any);
      res.json({ ok: true, features: pickFeatures(saved) });
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
