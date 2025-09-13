import dotenv from 'dotenv';
import crypto from 'crypto';
import { ConfigManager } from '../services';
import { YahooOAuthClient } from '../services/YahooOAuthClient';
import { YahooApiService } from '../services/YahooApiService';

dotenv.config();

function mask(val?: string): string {
  if (!val) return '';
  if (val.length <= 6) return '*'.repeat(val.length);
  return `${val.slice(0, 3)}***${val.slice(-3)}`;
}

async function ensureAuth(oauth: YahooOAuthClient, mgr: ConfigManager) {
  try {
    const token = await oauth.getValidAccessToken();
    return token;
  } catch (e) {
    const redirectUri = process.env.REDIRECT_URI || `https://localhost:${process.env.PORT || 3000}/oauth/callback`;
    const state = crypto.randomBytes(8).toString('hex');
    const url = oauth.getAuthorizationUrl(redirectUri, state);
    console.log('Yahoo auth required. Two options:');
    console.log('1) Start the web dashboard (npm run web), then click "Connect Yahoo".');
    console.log('   Redirect URI should be registered as:', redirectUri);
    console.log(`   Dashboard URL: https://localhost:${process.env.PORT || 3000}/auth/yahoo/start`);
    console.log('');
    console.log('2) Manual flow (advanced): open this URL and complete consent,');
    console.log('   then copy the code from the redirect URL and exchange via a one-off script:');
    console.log(url);
    process.exit(0);
  }
}

async function main() {
  console.log('Yahoo API demo starting...');
  const mgr = new ConfigManager();
  const oauth = new YahooOAuthClient(mgr);
  const svc = new YahooApiService(oauth);

  // Ensure we have credentials bootstrapped if secure store enabled
  if (process.env.CONFIG_ENCRYPTION_KEY) {
    const existing = mgr.loadYahooCredentials();
    if (!existing) {
      try {
        const envY = mgr.getYahooEnvCredentials();
        mgr.saveYahooCredentials(envY);
        console.log('Bootstrapped Yahoo creds to secure store (clientId=%s)', mask(envY.clientId));
      } catch (e) {
        console.warn('Yahoo env creds missing; set YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET');
      }
    }
  }

  await ensureAuth(oauth, mgr);
  const cid = process.env.YAHOO_CLIENT_ID;
  if (cid) {
    console.log('Using Yahoo client id (masked):', mask(cid));
  }

  const s = mgr.loadAppSettings();
  const leagueKey = s.leagueKey;
  const teamKey = s.teamKey;

  if (leagueKey) {
    try {
      const league = await svc.getLeague(leagueKey);
      console.log('League:', { id: league.id, name: league.name, season: league.season, currentWeek: league.currentWeek });
      const ww = await svc.getWaiverWirePlayers(leagueKey);
      console.log('Waiver wire sample:', ww.slice(0, 5).map((p) => ({ id: p.id, name: p.name, pos: p.position, team: p.team })));
    } catch (e) {
      console.error('Failed league calls:', (e as Error).message);
    }
  } else {
    console.log('Set leagueKey in config/app-settings.json to fetch league and waivers.');
  }

  if (teamKey) {
    try {
      const roster = await svc.getTeamRoster(teamKey);
      console.log('Roster sample:', roster.slice(0, 5).map((p) => ({ id: p.id, name: p.name, pos: p.position, team: p.team })));
    } catch (e) {
      console.error('Failed team roster call:', (e as Error).message);
    }
  } else {
    console.log('Set teamKey in config/app-settings.json to fetch roster.');
  }
}

main().catch((e) => {
  console.error('Demo error:', e);
  process.exit(1);
});
