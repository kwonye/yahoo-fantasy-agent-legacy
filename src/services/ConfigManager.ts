/**
 * @fileoverview Manages application configuration, including loading from environment variables,
 * JSON files, and a secure, encrypted store for credentials.
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { ApiCredentials, YahooCredentials, GeminiCredentials, RiskLevel, AuthToken, LeagueProfile, AppSettings } from '../models';
import { SecureStore } from './SecureStore';
import { KvSecureStore } from './KvSecureStore';

/**
 * @interface ConfigManagerOptions
 * @description Options for initializing the ConfigManager.
 * @property {string} [configDir] - Directory to store encrypted credentials.
 * @property {string} [encryptionKey] - Encryption key, overrides environment variable.
 */
export interface ConfigManagerOptions {
  configDir?: string; // where to store encrypted credentials
  encryptionKey?: string; // overrides env var
  
}

/**
 * @private
 * @typedef {object} ConfigStore
 * @description An internal type defining the interface for a secure storage mechanism.
 */
type ConfigStore = {
  save<T>(name: string, data: T): void;
  load<T>(name: string): T | null;
  remove(name: string): void;
};

/**
 * @class ConfigManager
 * @description Handles loading and saving of all application configuration, including API credentials,
 * application settings, and league-specific profiles. It supports both local file system and KV store
 * for secure credential storage.
 */
export class ConfigManager {
  private configDir: string;
  private readonly store: ConfigStore | null;
  private readonly storeUsesFilesystem: boolean;
  
  private readonly leaguesDir: string;
  private readonly appSettingsPath: string;

  /**
   * @constructor
   * @param {ConfigManagerOptions} [options={}] - Configuration options for the manager.
   */
  constructor(options: ConfigManagerOptions = {}) {
    dotenv.config();
    const preferredDir = options.configDir ?? process.env.CONFIG_DIR ?? path.join(process.cwd(), '.secure');
    this.configDir = preferredDir;
    const encryptionKey = options.encryptionKey ?? process.env.CONFIG_ENCRYPTION_KEY ?? '';
    let store: ConfigStore | null = null;
    let usesFs = false;
    if (encryptionKey) {
      const local = this.tryCreateLocalStore(preferredDir, encryptionKey);
      if (local) {
        store = local.store;
        this.configDir = local.dir;
        usesFs = true;
      } else {
        const kv = this.tryCreateKvStore(encryptionKey);
        if (kv) {
          store = kv;
          this.configDir = `kv:${process.env.CONFIG_KV_PREFIX ?? 'yahoo-fantasy-agent'}`;
          usesFs = false;
        } else {
          console.warn('[ConfigManager] SecureStore disabled: no writable directory and KV not configured.');
        }
      }
    }
    this.store = store;
    this.storeUsesFilesystem = usesFs;
    
    this.leaguesDir = path.join(process.cwd(), 'config', 'leagues');
    this.appSettingsPath = path.join(process.cwd(), 'config', 'app-settings.json');
  }

  /**
   * @method getEnvCredentials
   * @description Loads API credentials directly from environment variables. This is non-persistent.
   * @returns {ApiCredentials} The loaded API credentials.
   */
  getEnvCredentials(): ApiCredentials {
    // Non-persistent, direct from env (Yahoo only; Gemini is saved via dashboard)
    const yahoo: YahooCredentials = {
      clientId: this.required(process.env.YAHOO_CLIENT_ID, 'YAHOO_CLIENT_ID'),
      clientSecret: this.required(process.env.YAHOO_CLIENT_SECRET, 'YAHOO_CLIENT_SECRET'),
      accessToken: undefined,
      refreshToken: undefined,
    };
    const gemini: GeminiCredentials = {
      apiKey: '',
    };
    return { yahoo, gemini };
  }

  /**
   * @method getYahooEnvCredentials
   * @description Loads Yahoo-specific credentials from environment variables.
   * @returns {YahooCredentials} The loaded Yahoo credentials.
   */
  getYahooEnvCredentials(): YahooCredentials {
    return {
      clientId: this.required(process.env.YAHOO_CLIENT_ID, 'YAHOO_CLIENT_ID'),
      clientSecret: this.required(process.env.YAHOO_CLIENT_SECRET, 'YAHOO_CLIENT_SECRET'),
      accessToken: process.env.YAHOO_ACCESS_TOKEN,
      refreshToken: process.env.YAHOO_REFRESH_TOKEN,
    };
  }

  /**
   * @method saveYahooCredentials
   * @description Saves Yahoo credentials to the secure store.
   * @param {YahooCredentials} creds - The credentials to save.
   */
  saveYahooCredentials(creds: YahooCredentials): void {
    this.ensureStore();
    this.store!.save<YahooCredentials>('yahoo', creds);
  }

  /**
   * @method loadYahooCredentials
   * @description Loads Yahoo credentials from the secure store.
   * @returns {YahooCredentials | null} The loaded credentials, or null if not found.
   */
  loadYahooCredentials(): YahooCredentials | null {
    this.ensureStore();
    return this.store!.load<YahooCredentials>('yahoo');
  }

  /**
   * @method saveGeminiCredentials
   * @description Saves Gemini AI credentials to the secure store.
   * @param {GeminiCredentials} creds - The credentials to save.
   */
  saveGeminiCredentials(creds: GeminiCredentials): void {
    this.ensureStore();
    this.store!.save<GeminiCredentials>('gemini', creds);
  }

  /**
   * @method loadGeminiCredentials
   * @description Loads Gemini AI credentials from the secure store.
   * @returns {GeminiCredentials | null} The loaded credentials, or null if not found.
   */
  loadGeminiCredentials(): GeminiCredentials | null {
    this.ensureStore();
    return this.store!.load<GeminiCredentials>('gemini');
  }

  /**
   * @method saveYahooAuthToken
   * @description Saves a Yahoo OAuth token to the secure store.
   * @param {AuthToken} token - The token to save.
   */
  saveYahooAuthToken(token: AuthToken): void {
    this.ensureStore();
    this.store!.save<AuthToken>('yahoo-token', token);
  }

  /**
   * @method loadYahooAuthToken
   * @description Loads a Yahoo OAuth token from the secure store.
   * @returns {AuthToken | null} The loaded token, or null if not found.
   */
  loadYahooAuthToken(): AuthToken | null {
    this.ensureStore();
    const tok = this.store!.load<AuthToken>('yahoo-token');
    if (tok && typeof (tok as any).expiresAt === 'string') {
      // revive Date from JSON
      (tok as any).expiresAt = new Date((tok as any).expiresAt);
    }
    return tok;
  }

  /**
   * @method deleteYahooAuthToken
   * @description Deletes the Yahoo OAuth token from the secure store.
   */
  deleteYahooAuthToken(): void {
    this.ensureStore();
    try { this.store!.remove('yahoo-token'); } catch {}
  }
  
  /**
   * @method loadAppSettings
   * @description Loads the global application settings from a JSON file. If the file doesn't exist, it creates one with default values.
   * @returns {AppSettings} The loaded application settings.
   */
  loadAppSettings(): AppSettings {
    try {
      if (fs.existsSync(this.appSettingsPath)) {
        const raw = fs.readFileSync(this.appSettingsPath, 'utf8');
        const obj = JSON.parse(raw) as AppSettings;
        return this.applyAppDefaults(obj);
      }
    } catch {}
    // Seed with neutral defaults (no environment dependency)
    const seeded: AppSettings = this.applyAppDefaults({
      leagueKey: '',
      teamKey: '',
      redirectUri: '',
      scheduleEnabled: false,
      scheduleHour: 9,
      scheduleMinute: 0,
      kickoffEnabled: false,
      irAutomationEnabled: true,
      waiverAutomationEnabled: true,
      pickupsAutomationEnabled: false,
      tradesAutomationEnabled: true,
      tradeResponsesAutomationEnabled: true,
      debugYahooEnabled: false,
      applyChanges: false,
    });
    try { this.saveAppSettings(seeded); } catch {}
    return seeded;
  }

  /**
   * @method saveAppSettings
   * @description Saves the global application settings to a JSON file.
   * @param {AppSettings} settings - The settings to save.
   * @returns {AppSettings} The validated and saved settings.
   */
  saveAppSettings(settings: AppSettings): AppSettings {
    const validated = this.applyAppDefaults(settings);
    const dir = path.dirname(this.appSettingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.appSettingsPath, JSON.stringify(validated, null, 2), 'utf8');
    return validated;
  }

  /**
   * @private
   * @method applyAppDefaults
   * @description Applies default values to a partial AppSettings object to ensure a complete and valid configuration.
   * @param {Partial<AppSettings>} p - The partial settings object.
   * @returns {AppSettings} The complete settings object with defaults applied.
   */
  private applyAppDefaults(p: Partial<AppSettings>): AppSettings {
    const coerce = (n: any, def: number) => Number.isFinite(Number(n)) ? Number(n) : def;
    const base: AppSettings = {
      leagueKey: String(p.leagueKey || ''),
      teamKey: String(p.teamKey || ''),
      redirectUri: String(p.redirectUri || ''),
      scheduleEnabled: !!p.scheduleEnabled,
      scheduleHour: coerce(p.scheduleHour, 9),
      scheduleMinute: coerce(p.scheduleMinute, 0),
      kickoffEnabled: !!p.kickoffEnabled,
      irAutomationEnabled: p.irAutomationEnabled !== undefined ? !!p.irAutomationEnabled : true,
      waiverAutomationEnabled: p.waiverAutomationEnabled !== undefined ? !!p.waiverAutomationEnabled : true,
      pickupsAutomationEnabled: p.pickupsAutomationEnabled !== undefined ? !!p.pickupsAutomationEnabled : false,
      tradesAutomationEnabled: p.tradesAutomationEnabled !== undefined ? !!p.tradesAutomationEnabled : true,
      tradeResponsesAutomationEnabled: p.tradeResponsesAutomationEnabled !== undefined ? !!p.tradeResponsesAutomationEnabled : true,
      debugYahooEnabled: p.debugYahooEnabled !== undefined ? !!p.debugYahooEnabled : false,
      applyChanges: p.applyChanges !== undefined ? !!p.applyChanges : false,
      waiverDay: p.waiverDay !== undefined ? coerce(p.waiverDay, 2) : undefined,
      waiverHour: p.waiverHour !== undefined ? coerce(p.waiverHour, 7) : undefined,
      waiverMinute: p.waiverMinute !== undefined ? coerce(p.waiverMinute, 0) : undefined,
    };
    
    return base;
  }

  /**
   * @method loadLeagueProfile
   * @description Loads a league profile from a JSON file. It searches in several standard locations for the file.
   * @param {string} [_leagueKey] - The key of the league to load (currently unused, loads a single profile).
   * @returns {LeagueProfile | null} The loaded league profile, or null if not found.
   */
  loadLeagueProfile(_leagueKey?: string): LeagueProfile | null {
    try {
      // Try multiple candidate paths to be robust across cwd and dist/src layouts
      const candidates: string[] = [];
      const cwd = process.cwd();
      candidates.push(path.join(cwd, 'config', 'league_setting.json'));
      // In case the server is launched from dist/, try resolving relative to this file
      const here = __dirname; // src/services or dist/services
      candidates.push(path.resolve(here, '../../config/league_setting.json'));
      candidates.push(path.resolve(here, '../config/league_setting.json'));

      for (const p of candidates) {
        try {
          if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf8');
            return JSON.parse(raw) as LeagueProfile;
          }
        } catch { /* try next */ }
      }

      // Dynamic fallback: pick the first reasonable JSON file from a discovered config/ directory
      const tryConfigDir = (dir: string): LeagueProfile | null => {
        if (!fs.existsSync(dir)) return null;
        const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'));
        if (files.length === 0) return null;
        const preferredOrder = (name: string) =>
          name === 'league_setting.json' ? 0 :
          name.toLowerCase().includes('league') ? 1 :
          name === 'bot-config.json' ? 3 :
          2;
        files.sort((a, b) => preferredOrder(a) - preferredOrder(b));
        const chosen = files[0];
        if (!chosen) return null;
        const chosenPath = path.join(dir, chosen);
        try {
          const raw = fs.readFileSync(chosenPath, 'utf8');
          const obj = JSON.parse(raw) as LeagueProfile;
          // Normalize to league_setting.json at the same dir
          const target = path.join(dir, 'league_setting.json');
          try { fs.writeFileSync(target, JSON.stringify(obj, null, 2), 'utf8'); } catch {}
          return obj;
        } catch { return null; }
      };

      // 1) Try cwd/config
      const cfg1 = tryConfigDir(path.join(cwd, 'config'));
      if (cfg1) return cfg1;
      // 2) Walk up from __dirname to find a config/ folder
      let p: string | null = path.resolve(__dirname);
      for (let i = 0; i < 6 && p; i++) {
        const attempt = tryConfigDir(path.join(p, 'config'));
        if (attempt) return attempt;
        const next = path.dirname(p);
        if (next === p) break; // reached FS root
        p = next;
      }

      // Legacy fallbacks: config/leagues/league.json, then first JSON in config/leagues
      const legacyDir = path.join(cwd, 'config', 'leagues');
      const legacyFixed = path.join(legacyDir, 'league.json');
      let legacy: string | null = null;
      if (fs.existsSync(legacyFixed)) {
        legacy = legacyFixed;
      } else if (fs.existsSync(legacyDir)) {
        const files = fs.readdirSync(legacyDir).filter((f) => f.endsWith('.json'));
        const preferred = files.find((f) => f.includes('.l.')) || files[0];
        if (preferred) legacy = path.join(legacyDir, preferred);
      }
      if (legacy) {
        const obj = JSON.parse(fs.readFileSync(legacy, 'utf8')) as LeagueProfile;
        const dir = path.join(cwd, 'config');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const target = path.join(dir, 'league_setting.json');
        fs.writeFileSync(target, JSON.stringify(obj, null, 2), 'utf8');
        return obj;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * @method saveLeagueProfile
   * @description Saves a league profile to a standard JSON file location.
   * @param {LeagueProfile} profile - The league profile to save.
   * @returns {LeagueProfile} The saved league profile.
   */
  saveLeagueProfile(profile: LeagueProfile): LeagueProfile {
    const dir = path.join(process.cwd(), 'config');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'league_setting.json');
    fs.writeFileSync(p, JSON.stringify(profile, null, 2), 'utf8');
    return profile;
  }

  /**
   * @private
   * @method sanitizeKey
   * @description Sanitizes a string to be used as a file or key name.
   * @param {string} k - The string to sanitize.
   * @returns {string} The sanitized string.
   */
  private sanitizeKey(k: string): string {
    return String(k).replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  /**
   * @private
   * @method ensureStore
   * @description Ensures that a secure store is configured and available, throwing an error if not.
   */
  private ensureStore() {
    if (!this.store) {
      throw new Error('SecureStore not configured. Set CONFIG_ENCRYPTION_KEY or pass encryptionKey.');
    }
    if (this.storeUsesFilesystem && !fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  /**
   * @private
   * @method tryCreateLocalStore
   * @description Attempts to create a local file-based secure store.
   * @param {string} dir - The base directory for the store.
   * @param {string} encryptionKey - The encryption key.
   * @returns {{ store: SecureStore; dir: string } | null} The store instance or null on failure.
   */
  private tryCreateLocalStore(dir: string, encryptionKey: string): { store: SecureStore; dir: string } | null {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const testFile = path.join(dir, `.write-check-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      fs.writeFileSync(testFile, 'ok', 'utf8');
      try { fs.unlinkSync(testFile); } catch {}
      const store = new SecureStore({ baseDir: dir, encryptionKey });
      return { store, dir };
    } catch (e) {
      if ((process.env.CONFIG_DEBUG ?? '').toLowerCase() === '1') {
        console.warn('[ConfigManager] Local secure store init failed:', (e as Error).message);
      }
      return null;
    }
  }

  /**
   * @private
   * @method tryCreateKvStore
   * @description Attempts to create a KV-based secure store using environment variables.
   * @param {string} encryptionKey - The encryption key.
   * @returns {ConfigStore | null} The store instance or null on failure.
   */
  private tryCreateKvStore(encryptionKey: string): ConfigStore | null {
    const baseUrl = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (!baseUrl || !token) return null;
    try {
      const prefix = process.env.CONFIG_KV_PREFIX ?? 'yahoo-fantasy-agent';
      return new KvSecureStore({ baseUrl, token, encryptionKey, prefix });
    } catch (e) {
      console.warn('[ConfigManager] KV secure store init failed:', (e as Error).message);
      return null;
    }
  }

  /**
   * @private
   * @method parseRisk
   * @description Parses a string into a RiskLevel enum.
   * @param {string} [val] - The string to parse.
   * @returns {RiskLevel | undefined} The parsed risk level or undefined.
   */
  private parseRisk(val?: string): RiskLevel | undefined {
    if (!val) return undefined;
    const up = val.toUpperCase();
    if (up in RiskLevel) return up as RiskLevel;
    return undefined;
  }

  /**
   * @private
   * @method parseBool
   * @description Parses a string into a boolean.
   * @param {string} [val] - The string to parse.
   * @param {boolean} def - The default value if parsing fails.
   * @returns {boolean | undefined} The parsed boolean or the default.
   */
  private parseBool(val: string | undefined, def: boolean): boolean | undefined {
    if (val === undefined) return def;
    return /^true$/i.test(val) ? true : /^false$/i.test(val) ? false : def;
  }

  /**
   * @private
   * @method parseInt
   * @description Parses a string into an integer.
   * @param {string} [val] - The string to parse.
   * @param {number} def - The default value if parsing fails.
   * @returns {number | undefined} The parsed integer or the default.
   */
  private parseInt(val: string | undefined, def: number): number | undefined {
    if (val === undefined) return def;
    const n = Number.parseInt(val, 10);
    return Number.isFinite(n) ? n : def;
  }

  /**
   * @private
   * @method parseFloat
   * @description Parses a string into a float.
   * @param {string} [val] - The string to parse.
   * @param {number} def - The default value if parsing fails.
   * @returns {number | undefined} The parsed float or the default.
   */
  private parseFloat(val: string | undefined, def: number): number | undefined {
    if (val === undefined) return def;
    const n = Number.parseFloat(val);
    return Number.isFinite(n) ? n : def;
  }

  /**
   * @private
   * @method required
   * @description Ensures a value is not undefined, throwing an error if it is.
   * @param {string | undefined} val - The value to check.
   * @param {string} name - The name of the value, for the error message.
   * @returns {string} The value, if it exists.
   * @throws {Error} If the value is undefined.
   */
  private required(val: string | undefined, name: string): string {
    if (!val) throw new Error(`Missing required environment variable: ${name}`);
    return val;
  }

  // position priorities and static needs/surplus removed; Gemini infers these live
}
