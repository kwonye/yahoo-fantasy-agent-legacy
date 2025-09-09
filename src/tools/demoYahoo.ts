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
    const redirectUri = process.env.REDIRECT_URI;
    const authCode = process.env.AUTH_CODE;
    if (authCode && redirectUri) {
      console.log('Exchanging AUTH_CODE for tokens...');
      await oauth.exchangeCodeForToken(authCode, redirectUri);
      const token = await oauth.getValidAccessToken();
      return token;
    }
    if (!redirectUri) {
      console.log('Set REDIRECT_URI to your app callback to complete OAuth.');
      process.exit(0);
    }
    const state = crypto.randomBytes(8).toString('hex');
    const url = oauth.getAuthorizationUrl(redirectUri, state);
    console.log('Authorize the app in your browser:');
    console.log(url);
    console.log('Then set AUTH_CODE with the returned code and rerun this demo.');
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

  const leagueKey = process.env.LEAGUE_KEY;
  const teamKey = process.env.TEAM_KEY;

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
    console.log('Set LEAGUE_KEY to fetch league and waivers.');
  }

  if (teamKey) {
    try {
      const roster = await svc.getTeamRoster(teamKey);
      console.log('Roster sample:', roster.slice(0, 5).map((p) => ({ id: p.id, name: p.name, pos: p.position, team: p.team })));
    } catch (e) {
      console.error('Failed team roster call:', (e as Error).message);
    }
  } else {
    console.log('Set TEAM_KEY to fetch roster.');
  }
}

main().catch((e) => {
  console.error('Demo error:', e);
  process.exit(1);
});
