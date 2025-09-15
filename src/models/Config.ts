import { RiskLevel } from './Common';

export interface BotConfig {
  applyChanges: boolean; // when false, operate in dry-run mode and do not write to Yahoo
}

// UI-managed runtime settings
export interface AppSettings {
  leagueKey: string;
  teamKey: string;
  redirectUri: string;
  scheduleEnabled: boolean;
  scheduleHour: number;
  scheduleMinute: number;
  // Feature toggles
  kickoffEnabled: boolean;
  irAutomationEnabled: boolean;
  waiverAutomationEnabled: boolean;
  pickupsAutomationEnabled: boolean;
  tradesAutomationEnabled: boolean;
  debugYahooEnabled: boolean;
  // Apply changes flag (when false, operate in dry-run mode)
  applyChanges: boolean;
  // Optional waiver scheduler overrides
  waiverDay?: number;   // 0=Sun ... 6=Sat
  waiverHour?: number;  // 0-23
  waiverMinute?: number;// 0-59
}

export interface ApiCredentials {
  yahoo: YahooCredentials;
  gemini: GeminiCredentials;
}

export interface YahooCredentials {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface GeminiCredentials {
  apiKey: string;
  model?: string;
}

export interface AuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface AnalysisContext {
  week: number;
  season: number;
  leagueSettings: any;
  userPreferences: BotConfig;
  // Optional extensions used by waivers/trades
  faabBudgetRemaining?: number; // remaining FAAB budget for my team
  waiverType?: string; // e.g., 'FAAB' or 'R' (rolling priority)
  leagueProfile?: any; // optional loaded league profile JSON
}
