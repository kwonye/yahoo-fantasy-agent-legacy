import { RiskLevel } from './Common';

export interface BotConfig {
  riskTolerance: RiskLevel;
  tradingEnabled: boolean;
  waiverWireEnabled: boolean;
  maxWaiverClaims: number;
  tradeThreshold: number;
  applyChanges: boolean; // when false, operate in dry-run mode and do not write to Yahoo
  // Legacy hinting; Gemini infers priorities at runtime (kept for compatibility)
  positionPriorities: Record<string, number>;
  tradeNeeds?: string[];
  tradeSurplus?: string[];
  neverDrop?: string[]; // player IDs that should never be dropped
}

// UI-managed runtime settings
export interface AppSettings {
  leagueKey: string;
  teamKey: string;
  scheduleEnabled: boolean;
  scheduleHour: number;
  scheduleMinute: number;
  // Feature toggles
  kickoffEnabled: boolean;
  irAutomationEnabled: boolean;
  waiverAutomationEnabled: boolean;
  tradesAutomationEnabled: boolean;
  // Optional waiver scheduler overrides
  waiverDay?: number;   // 0=Sun ... 6=Sat
  waiverHour?: number;  // 0-23
  waiverMinute?: number;// 0-59
  // Consolidated bot configuration (migrated from bot-config.json and env)
  bot?: BotConfig;
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
