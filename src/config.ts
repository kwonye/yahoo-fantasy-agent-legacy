import dotenv from 'dotenv';
dotenv.config({ override: true });
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
  yahooScope: 'fspt-w' | 'fspt-r';
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
  yahooRedirectUri: process.env.YAHOO_REDIRECT_URI || 'https://localhost:3443/auth/callback',
  yahooScope: (process.env.YAHOO_SCOPE as any) || 'fspt-w',
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
    faabBudget: Number(localManager.faabBudget ?? 100),
    weeklyFaabMax: localManager.weeklyFaabMax,
    waiverProcessTime: localManager.waiverProcessTime,
    aggressiveness: Number(localManager.aggressiveness ?? 0.5),
    injuryRiskTolerance: Number(localManager.injuryRiskTolerance ?? 0.4),
    positionPriority: localManager.positionPriority ?? { RB: 1.0, WR: 0.95, QB: 0.8, TE: 0.7, K: 0.2, DEF: 0.3 },
  },
};

/**
 * Ensure Yahoo OAuth env vars exist. Does NOT require a Gemini API key.
 */
export function assertYahooSecrets() {
  console.log('config.yahooClientId:', config.yahooClientId); // Added console.log
  const missing: string[] = [];
  if (!config.yahooClientId) missing.push('YAHOO_CLIENT_ID');
  if (!config.yahooClientSecret) missing.push('YAHOO_CLIENT_SECRET');
  if (!config.yahooRedirectUri) missing.push('YAHOO_REDIRECT_URI');

  if (missing.length) {
    console.error('\n🚨 SETUP REQUIRED (Yahoo) 🚨');
    console.error('Missing required environment variables:');
    missing.forEach(key => console.error(`  - ${key}`));
    console.error('\nPlease check the README.md for setup instructions.');
    console.error('You need to:\n1. Create a Yahoo Developer app at https://developer.yahoo.com/apps/\n2. Find your Yahoo league and team keys from your fantasy league URL\n3. Copy .env.example to .env and fill in your values\n');
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

/**
 * Ensure Gemini API key exists for AI features.
 */
export function assertGeminiSecret() {
  if (!config.geminiApiKey) {
    console.error('\n🚨 SETUP REQUIRED (Gemini) 🚨');
    console.error('Missing required environment variable: GEMINI_API_KEY');
    console.error('Get a Gemini API key from https://aistudio.google.com/ and set GEMINI_API_KEY in your .env');
    throw new Error('Missing required env vars: GEMINI_API_KEY');
  }
}

// Backward-compat alias for any legacy imports
export const assertSecrets = assertYahooSecrets;
