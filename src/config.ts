import fs from 'fs';
import path from 'path';

export type ManagerConfig = {
  faabBudget: number; // remaining FAAB budget
  weeklyFaabMax?: number; // optional weekly cap
  waiverProcessTime?: string; // e.g., '03:00' local TZ
  aggressiveness: number; // 0..1
  injuryRiskTolerance: number; // 0..1
  positionPriority?: Record<string, number>; // e.g., { RB: 1.0, WR: 0.9, TE: 0.6 }
};

export type Config = {
  yahooClientId: string;
  yahooClientSecret: string;
  yahooRedirectUri: string;
  leagueKey?: string; // e.g., 'nfl.l.12345'
  teamKey?: string; // e.g., 'nfl.l.12345.t.1'
  geminiApiKey?: string;
  timezone: string;
  autoEnable: boolean;
  cron: {
    lineup: string; // frequent lineup checks
    waivers: string; // when waivers typically process
    trades: string; // when to attempt trades
    daily: string; // general daily maintenance
    newsPollMinutes: number; // news poll interval
  };
  newsProvider: 'sleeper' | 'noop';
  manager: ManagerConfig;
};

function loadLocalManagerConfig(): Partial<ManagerConfig> {
  try {
    const cfgPath = path.join(process.cwd(), 'config', 'app.config.json');
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.manager || parsed || {};
  } catch {
    return {};
  }
}

const localManager = loadLocalManagerConfig();

export const config: Config = {
  yahooClientId: process.env.YAHOO_CLIENT_ID || '',
  yahooClientSecret: process.env.YAHOO_CLIENT_SECRET || '',
  yahooRedirectUri: process.env.YAHOO_REDIRECT_URI || 'http://localhost:3000/auth/callback',
  leagueKey: process.env.YAHOO_LEAGUE_KEY,
  teamKey: process.env.YAHOO_TEAM_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  timezone: process.env.TZ || 'America/Los_Angeles',
  autoEnable: process.env.AUTO_ENABLE === 'true',
  cron: {
    lineup: process.env.LINEUP_CRON || '*/10 * * * *',
    waivers: process.env.WAIVER_CRON || '5 3 * * *',
    trades: process.env.TRADE_CRON || '0 9 * * *',
    daily: process.env.DAILY_CRON || '0 8 * * *',
    newsPollMinutes: Number(process.env.NEWS_POLL_MIN || 5),
  },
  newsProvider: (process.env.NEWS_PROVIDER as any) || 'sleeper',
  manager: {
    faabBudget: Number(process.env.FAAB_BUDGET ?? localManager.faabBudget ?? 100),
    weeklyFaabMax: localManager.weeklyFaabMax,
    waiverProcessTime: localManager.waiverProcessTime,
    aggressiveness: Number(process.env.MGR_AGGRESSIVENESS ?? localManager.aggressiveness ?? 0.5),
    injuryRiskTolerance: Number(process.env.MGR_INJURY_RISK ?? localManager.injuryRiskTolerance ?? 0.4),
    positionPriority: localManager.positionPriority ?? { RB: 1.0, WR: 0.95, QB: 0.8, TE: 0.7, K: 0.2, DEF: 0.3 },
  },
};

export function assertSecrets() {
  const missing: string[] = [];
  if (!config.yahooClientId) missing.push('YAHOO_CLIENT_ID');
  if (!config.yahooClientSecret) missing.push('YAHOO_CLIENT_SECRET');
  if (!config.yahooRedirectUri) missing.push('YAHOO_REDIRECT_URI');
  if (!config.geminiApiKey) missing.push('GEMINI_API_KEY');
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}
