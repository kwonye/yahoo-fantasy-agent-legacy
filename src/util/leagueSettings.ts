import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getLeagueSettings } from '../clients/yahooFantasy.js';
import { normalizeLeagueSettings, NormalizedLeagueSettings } from '../clients/yahooParsers.js';

export type LeagueSettingsBundle = {
  yahooRaw?: any;
  yahooNormalized?: NormalizedLeagueSettings;
  overrides?: Partial<NormalizedLeagueSettings>;
  effective: NormalizedLeagueSettings; // normalized + overrides
};

export function readLocalLeagueOverrides(): any | null {
  try {
    const cfgPath = path.join(process.cwd(), 'config', 'app.config.json');
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.league || null;
  } catch {
    return null;
  }
}

function isObject(x: any): x is Record<string, any> {
  return x && typeof x === 'object' && !Array.isArray(x);
}

function mergeDeep(base: any, overrides: any): any {
  if (!isObject(base)) return overrides ?? base;
  if (!isObject(overrides)) return base;
  const out: any = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (isObject(v)) out[k] = mergeDeep(base[k], v);
    else out[k] = v;
  }
  return out;
}

export async function getEffectiveLeagueSettings(): Promise<LeagueSettingsBundle> {
  let yahooRaw: any | undefined;
  try {
    if (config.leagueKey) {
      yahooRaw = await getLeagueSettings(config.leagueKey);
    }
  } catch {
    // ignore failures; we'll rely on overrides if present
  }
  const yahooNormalized = yahooRaw ? normalizeLeagueSettings(yahooRaw) : undefined;
  const overrides = readLocalLeagueOverrides() || undefined;
  const base: NormalizedLeagueSettings = yahooNormalized ?? {} as any;
  const effective: NormalizedLeagueSettings = overrides ? mergeDeep(base, overrides) : base;
  return { yahooRaw, yahooNormalized, overrides, effective };
}
