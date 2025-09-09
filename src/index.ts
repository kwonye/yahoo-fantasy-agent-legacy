// Main entry point for the Fantasy Football Bot
import dotenv from 'dotenv';
import { ConfigManager } from './services';

dotenv.config();

function mask(val?: string): string {
  if (!val) return '';
  if (val.length <= 6) return '*'.repeat(val.length);
  return `${val.slice(0, 3)}***${val.slice(-3)}`;
}

async function main() {
  console.log('Fantasy Football Bot starting...');

  const mgr = new ConfigManager();
  // Load bot configuration (with defaults and validation)
  let botCfg;
  try {
    botCfg = mgr.getBotConfig();
  } catch (err) {
    console.error('Invalid bot configuration:', err);
    process.exitCode = 1;
    return;
  }
  console.log('Bot configuration loaded:', {
    riskTolerance: botCfg.riskTolerance,
    tradingEnabled: botCfg.tradingEnabled,
    waiverWireEnabled: botCfg.waiverWireEnabled,
    maxWaiverClaims: botCfg.maxWaiverClaims,
    tradeThreshold: botCfg.tradeThreshold,
    applyChanges: botCfg.applyChanges,
  });

  const hasSecureStore = !!process.env.CONFIG_ENCRYPTION_KEY;
  if (hasSecureStore) {
    console.log('Secure credential storage: enabled');
    // Try load encrypted creds; if missing, bootstrap from env
    try {
      const yahoo = mgr.loadYahooCredentials();
      const gemini = mgr.loadGeminiCredentials();

      if (!yahoo || !gemini) {
        try {
          const envCreds = mgr.getEnvCredentials();
          if (!yahoo) {
            mgr.saveYahooCredentials(envCreds.yahoo);
            console.log('Yahoo credentials bootstrapped to secure store (clientId=%s)', mask(envCreds.yahoo.clientId));
          }
          if (!gemini) {
            mgr.saveGeminiCredentials(envCreds.gemini);
            console.log('Gemini API key bootstrapped to secure store (apiKey=%s)', mask(envCreds.gemini.apiKey));
          }
        } catch (e) {
          console.warn('Could not bootstrap credentials from environment:', (e as Error).message);
          console.warn('Set YAHOO_CLIENT_ID/YAHOO_CLIENT_SECRET and GEMINI_API_KEY to bootstrap.');
        }
      }
    } catch (e) {
      console.error('Secure store error:', e);
    }
  } else {
    console.log('Secure credential storage: disabled (set CONFIG_ENCRYPTION_KEY to enable)');
    if (!process.env.GEMINI_API_KEY) {
      console.warn('Missing GEMINI_API_KEY');
    }
    if (!process.env.YAHOO_CLIENT_ID || !process.env.YAHOO_CLIENT_SECRET) {
      console.warn('Missing YAHOO_CLIENT_ID and/or YAHOO_CLIENT_SECRET');
    }
  }

  // App ready; subsequent tasks will orchestrate bot operations
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
