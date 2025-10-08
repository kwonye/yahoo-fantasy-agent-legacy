/**
 * @fileoverview Configuration interfaces for the application.
 */
import { RiskLevel } from './Common';

/**
 * @interface BotConfig
 * @description Configuration for the bot's behavior.
 * @property {boolean} applyChanges - If true, the bot will apply changes to the Yahoo fantasy league. If false, it will operate in dry-run mode.
 */
export interface BotConfig {
  applyChanges: boolean; // when false, operate in dry-run mode and do not write to Yahoo
}

/**
 * @interface AppSettings
 * @description Application settings managed through the UI.
 * @property {string} leagueKey - The key for the fantasy league.
 * @property {string} teamKey - The key for the fantasy team.
 * @property {string} redirectUri - The redirect URI for Yahoo OAuth.
 * @property {boolean} scheduleEnabled - Whether the daily schedule is enabled.
 * @property {number} scheduleHour - The hour (0-23) for the daily schedule.
 * @property {number} scheduleMinute - The minute (0-59) for the daily schedule.
 * @property {boolean} kickoffEnabled - Whether kickoff-time checks are enabled.
 * @property {boolean} irAutomationEnabled - Whether IR automation is enabled.
 * @property {boolean} waiverAutomationEnabled - Whether waiver automation is enabled.
 * @property {boolean} pickupsAutomationEnabled - Whether free agent pickup automation is enabled.
 * @property {boolean} tradesAutomationEnabled - Whether trade evaluation automation is enabled.
 * @property {boolean} tradeResponsesAutomationEnabled - Whether automated responses to trade offers are enabled.
 * @property {boolean} debugYahooEnabled - Whether to enable debug logging for Yahoo API calls.
 * @property {boolean} applyChanges - If true, the bot will apply changes. If false, it will operate in dry-run mode.
 * @property {number} [waiverDay] - Optional override for the waiver processing day (0=Sun, 6=Sat).
 * @property {number} [waiverHour] - Optional override for the waiver processing hour (0-23).
 * @property {number} [waiverMinute] - Optional override for the waiver processing minute (0-59).
 */
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
  tradeResponsesAutomationEnabled: boolean;
  debugYahooEnabled: boolean;
  // Apply changes flag (when false, operate in dry-run mode)
  applyChanges: boolean;
  // Optional waiver scheduler overrides
  waiverDay?: number;   // 0=Sun ... 6=Sat
  waiverHour?: number;  // 0-23
  waiverMinute?: number;// 0-59
}

/**
 * @interface ApiCredentials
 * @description Credentials for external APIs.
 * @property {YahooCredentials} yahoo - Credentials for the Yahoo API.
 * @property {GeminiCredentials} gemini - Credentials for the Gemini API.
 */
export interface ApiCredentials {
  yahoo: YahooCredentials;
  gemini: GeminiCredentials;
}

/**
 * @interface YahooCredentials
 * @description Credentials for the Yahoo API.
 * @property {string} clientId - The client ID for the Yahoo application.
 * @property {string} clientSecret - The client secret for the Yahoo application.
 * @property {string} [accessToken] - The access token for the Yahoo API.
 * @property {string} [refreshToken] - The refresh token for the Yahoo API.
 */
export interface YahooCredentials {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
}

/**
 * @interface GeminiCredentials
 * @description Credentials for the Gemini API.
 * @property {string} apiKey - The API key for the Gemini API.
 * @property {string} [model] - The specific model to use (e.g., 'gemini-pro').
 */
export interface GeminiCredentials {
  apiKey: string;
  model?: string;
}

/**
 * @interface AuthToken
 * @description Represents an OAuth token.
 * @property {string} accessToken - The access token.
 * @property {string} refreshToken - The refresh token.
 * @property {Date} expiresAt - The expiration date of the access token.
 */
export interface AuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * @interface AnalysisContext
 * @description Contextual information for AI analysis.
 * @property {number} week - The current week of the fantasy season.
 * @property {number} season - The current season.
 * @property {any} leagueSettings - The settings for the fantasy league.
 * @property {BotConfig} userPreferences - The user's bot configuration.
 * @property {number} [faabBudgetRemaining] - The remaining FAAB budget for the team.
 * @property {string} [waiverType] - The type of waiver system used (e.g., 'FAAB', 'R').
 * @property {any} [leagueProfile] - Optional loaded league profile JSON.
 */
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
