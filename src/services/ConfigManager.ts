import path from 'path';
import os from 'os';
import fs from 'fs';
import dotenv from 'dotenv';
import { BotConfig, ApiCredentials, YahooCredentials, GeminiCredentials, RiskLevel, AuthToken, LeagueProfile, AppSettings } from '../models';
import { SecureStore } from './SecureStore';

export interface ConfigManagerOptions {
  configDir?: string; // where to store encrypted credentials
  encryptionKey?: string; // overrides env var
  preferencesPath?: string; // path to store bot config overrides (json)
}

export class ConfigManager {
  private readonly configDir: string;
  private readonly store: SecureStore | null;
  private readonly preferencesPath: string;
  private readonly leaguesDir: string;
  private readonly appSettingsPath: string;

  constructor(options: ConfigManagerOptions = {}) {
    dotenv.config();
    const defaultDir = path.join(process.cwd(), '.secure');
    this.configDir = options.configDir ?? process.env.CONFIG_DIR ?? defaultDir;
    const encryptionKey = options.encryptionKey ?? process.env.CONFIG_ENCRYPTION_KEY ?? '';
    this.store = encryptionKey ? new SecureStore({ baseDir: this.configDir, encryptionKey }) : null;
    const defaultPrefsPath = path.join(process.cwd(), 'config', 'bot-config.json');
    this.preferencesPath = options.preferencesPath ?? process.env.BOT_CONFIG_PATH ?? defaultPrefsPath;
    this.leaguesDir = path.join(process.cwd(), 'config', 'leagues');
    this.appSettingsPath = path.join(process.cwd(), 'config', 'app-settings.json');
  }

  // --------- Public API ---------
  getBotConfig(): BotConfig {
    // Source exclusively from app-settings; migrate legacy bot-config.json if present.
    let app = this.loadAppSettings();
    let bot = (app as any).bot as Partial<BotConfig> | undefined;
    if (!bot || Object.keys(bot).length === 0) {
      const legacy = this.loadPreferences();
      if (legacy && Object.keys(legacy).length > 0) {
        bot = legacy as Partial<BotConfig>;
        // Persist migration into app-settings
        app = this.saveAppSettings({ ...app, bot: this.applyDefaults(bot) });
      }
    }
    const withDefaults = this.applyDefaults(bot || {});
    this.validateBotConfig(withDefaults);
    // Ensure app-settings always carries bot config
    if (!(app as any).bot) {
      this.saveAppSettings({ ...app, bot: withDefaults });
    }
    return withDefaults;
  }

  getEnvCredentials(): ApiCredentials {
    // Non-persistent, direct from env (useful as bootstrap)
    const yahoo: YahooCredentials = {
      clientId: this.required(process.env.YAHOO_CLIENT_ID, 'YAHOO_CLIENT_ID'),
      clientSecret: this.required(process.env.YAHOO_CLIENT_SECRET, 'YAHOO_CLIENT_SECRET'),
      accessToken: process.env.YAHOO_ACCESS_TOKEN,
      refreshToken: process.env.YAHOO_REFRESH_TOKEN,
    };
    const gemini: GeminiCredentials = {
      apiKey: this.required(process.env.GEMINI_API_KEY, 'GEMINI_API_KEY'),
    };
    return { yahoo, gemini };
  }

  getYahooEnvCredentials(): YahooCredentials {
    return {
      clientId: this.required(process.env.YAHOO_CLIENT_ID, 'YAHOO_CLIENT_ID'),
      clientSecret: this.required(process.env.YAHOO_CLIENT_SECRET, 'YAHOO_CLIENT_SECRET'),
      accessToken: process.env.YAHOO_ACCESS_TOKEN,
      refreshToken: process.env.YAHOO_REFRESH_TOKEN,
    };
  }

  // Encrypted persistent credentials
  saveYahooCredentials(creds: YahooCredentials): void {
    this.ensureStore();
    this.store!.save<YahooCredentials>('yahoo', creds);
  }

  loadYahooCredentials(): YahooCredentials | null {
    this.ensureStore();
    return this.store!.load<YahooCredentials>('yahoo');
  }

  saveGeminiCredentials(creds: GeminiCredentials): void {
    this.ensureStore();
    this.store!.save<GeminiCredentials>('gemini', creds);
  }

  loadGeminiCredentials(): GeminiCredentials | null {
    this.ensureStore();
    return this.store!.load<GeminiCredentials>('gemini');
  }

  saveYahooAuthToken(token: AuthToken): void {
    this.ensureStore();
    this.store!.save<AuthToken>('yahoo-token', token);
  }

  loadYahooAuthToken(): AuthToken | null {
    this.ensureStore();
    const tok = this.store!.load<AuthToken>('yahoo-token');
    if (tok && typeof (tok as any).expiresAt === 'string') {
      // revive Date from JSON
      (tok as any).expiresAt = new Date((tok as any).expiresAt);
    }
    return tok;
  }

  deleteYahooAuthToken(): void {
    this.ensureStore();
    try { (this.store as any).remove('yahoo-token'); } catch {}
  }

  // --------- Helpers ---------
  savePreferences(partial: Partial<BotConfig>): BotConfig {
    // Persist bot config into app-settings exclusively
    const app = this.loadAppSettings();
    const current = ((app as any).bot || {}) as Partial<BotConfig>;
    const next = { ...current, ...partial } as Partial<BotConfig>;
    const validated = this.applyDefaults(next);
    this.validateBotConfig(validated);
    this.saveAppSettings({ ...app, bot: validated });
    return validated;
  }

  loadPreferences(): Partial<BotConfig> {
    // Legacy loader for bot-config.json; used only for one-time migration
    try {
      if (!fs.existsSync(this.preferencesPath)) return {};
      const raw = fs.readFileSync(this.preferencesPath, 'utf8');
      const obj = JSON.parse(raw);
      return obj as Partial<BotConfig>;
    } catch {
      return {};
    }
  }

  // --------- App settings (UI-managed global state) ---------
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
      scheduleEnabled: false,
      scheduleHour: 9,
      scheduleMinute: 0,
      kickoffEnabled: false,
      irAutomationEnabled: true,
      waiverAutomationEnabled: true,
      tradesAutomationEnabled: true,
    } as any);
    try { this.saveAppSettings(seeded); } catch {}
    return seeded;
  }

  saveAppSettings(settings: AppSettings): AppSettings {
    const validated = this.applyAppDefaults(settings);
    const dir = path.dirname(this.appSettingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.appSettingsPath, JSON.stringify(validated, null, 2), 'utf8');
    return validated;
  }

  private applyAppDefaults(p: Partial<AppSettings>): AppSettings {
    const coerce = (n: any, def: number) => Number.isFinite(Number(n)) ? Number(n) : def;
    const base: AppSettings = {
      leagueKey: String(p.leagueKey || ''),
      teamKey: String(p.teamKey || ''),
      scheduleEnabled: !!p.scheduleEnabled,
      scheduleHour: coerce(p.scheduleHour, 9),
      scheduleMinute: coerce(p.scheduleMinute, 0),
      kickoffEnabled: !!p.kickoffEnabled,
      irAutomationEnabled: p.irAutomationEnabled !== undefined ? !!p.irAutomationEnabled : true,
      waiverAutomationEnabled: p.waiverAutomationEnabled !== undefined ? !!p.waiverAutomationEnabled : true,
      tradesAutomationEnabled: p.tradesAutomationEnabled !== undefined ? !!p.tradesAutomationEnabled : true,
      waiverDay: p.waiverDay !== undefined ? coerce(p.waiverDay, 2) : undefined,
      waiverHour: p.waiverHour !== undefined ? coerce(p.waiverHour, 7) : undefined,
      waiverMinute: p.waiverMinute !== undefined ? coerce(p.waiverMinute, 0) : undefined,
    };
    // Preserve existing bot config if present; otherwise leave undefined to allow defaults
    if ((p as any).bot) (base as any).bot = (p as any).bot as any;
    return base;
  }

  // --------- League profile (per-league scoring & settings) ---------
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

  saveLeagueProfile(profile: LeagueProfile): LeagueProfile {
    const dir = path.join(process.cwd(), 'config');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'league_setting.json');
    fs.writeFileSync(p, JSON.stringify(profile, null, 2), 'utf8');
    return profile;
  }

  private sanitizeKey(k: string): string {
    return String(k).replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private ensureStore() {
    if (!this.store) {
      throw new Error('SecureStore not configured. Set CONFIG_ENCRYPTION_KEY or pass encryptionKey.');
    }
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  private parseRisk(val?: string): RiskLevel | undefined {
    if (!val) return undefined;
    const up = val.toUpperCase();
    if (up in RiskLevel) return up as RiskLevel;
    return undefined;
  }

  // position priorities are no longer configurable; Gemini infers them per context

  private parseBool(val: string | undefined, def: boolean): boolean | undefined {
    if (val === undefined) return def;
    return /^true$/i.test(val) ? true : /^false$/i.test(val) ? false : def;
  }

  private parseInt(val: string | undefined, def: number): number | undefined {
    if (val === undefined) return def;
    const n = Number.parseInt(val, 10);
    return Number.isFinite(n) ? n : def;
  }

  private parseFloat(val: string | undefined, def: number): number | undefined {
    if (val === undefined) return def;
    const n = Number.parseFloat(val);
    return Number.isFinite(n) ? n : def;
  }

  private applyDefaults(cfg: Partial<BotConfig>): BotConfig {
    const defaults: BotConfig = {
      riskTolerance: RiskLevel.MODERATE,
      tradingEnabled: true,
      waiverWireEnabled: true,
      maxWaiverClaims: 3,
      tradeThreshold: 0,
      applyChanges: false,
      positionPriorities: {},
      tradeNeeds: [],
      tradeSurplus: [],
      neverDrop: [],
    };
    return {
      riskTolerance: cfg.riskTolerance ?? defaults.riskTolerance,
      tradingEnabled: cfg.tradingEnabled ?? defaults.tradingEnabled,
      waiverWireEnabled: cfg.waiverWireEnabled ?? defaults.waiverWireEnabled,
      maxWaiverClaims: cfg.maxWaiverClaims ?? defaults.maxWaiverClaims,
      tradeThreshold: cfg.tradeThreshold ?? defaults.tradeThreshold,
      applyChanges: cfg.applyChanges ?? defaults.applyChanges,
      positionPriorities: (cfg as any).positionPriorities ?? defaults.positionPriorities,
      tradeNeeds: Array.isArray(cfg.tradeNeeds) ? cfg.tradeNeeds : defaults.tradeNeeds,
      tradeSurplus: Array.isArray(cfg.tradeSurplus) ? cfg.tradeSurplus : defaults.tradeSurplus,
      neverDrop: Array.isArray((cfg as any).neverDrop) ? (cfg as any).neverDrop : defaults.neverDrop,
    };
  }

  private validateBotConfig(cfg: BotConfig) {
    if (!Object.values(RiskLevel).includes(cfg.riskTolerance)) {
      throw new Error('Invalid riskTolerance');
    }
    if (typeof cfg.maxWaiverClaims !== 'number' || cfg.maxWaiverClaims < 0) {
      throw new Error('Invalid maxWaiverClaims');
    }
    if (typeof cfg.tradeThreshold !== 'number' || cfg.tradeThreshold < 0) {
      throw new Error('Invalid tradeThreshold');
    }
    // position priorities are derived live by Gemini; none to validate
    if (cfg.positionPriorities && typeof cfg.positionPriorities !== 'object') {
      throw new Error('Invalid positionPriorities');
    }
    if (!Array.isArray(cfg.tradeNeeds) || !cfg.tradeNeeds.every((s) => typeof s === 'string')) {
      throw new Error('Invalid tradeNeeds');
    }
    if (!Array.isArray(cfg.tradeSurplus) || !cfg.tradeSurplus.every((s) => typeof s === 'string')) {
      throw new Error('Invalid tradeSurplus');
    }
    if (cfg.neverDrop && (!Array.isArray(cfg.neverDrop) || !cfg.neverDrop.every((s) => typeof s === 'string'))) {
      throw new Error('Invalid neverDrop');
    }
  }

  private required(val: string | undefined, name: string): string {
    if (!val) throw new Error(`Missing required environment variable: ${name}`);
    return val;
  }

  private parsePositionPriorities(val?: string): Record<string, number> | undefined {
    if (!val) return undefined;
    try {
      // Support JSON or shorthand QB:4,RB:5
      const s = val.trim();
      if (!s) return undefined;
      if (s.startsWith('{')) {
        const obj = JSON.parse(s);
        return obj && typeof obj === 'object' ? (obj as Record<string, number>) : undefined;
      }
      const out: Record<string, number> = {};
      for (const part of s.split(',').map((p) => p.trim()).filter(Boolean)) {
        const [k, v] = part.split(':').map((x) => x.trim());
        const num = Number(v);
        if (k && Number.isFinite(num)) out[k] = num;
      }
      return out;
    } catch {
      return undefined;
    }
  }
}
