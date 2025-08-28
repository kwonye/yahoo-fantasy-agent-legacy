import axios, { AxiosInstance } from 'axios';
import { loadTokens } from '../store/tokenStore.js';
import { refreshTokensIfNeeded } from './yahooAuth.js';
import { logger } from '../logger.js';

const YAHOO_FANTASY_BASE = 'https://fantasysports.yahooapis.com/fantasy/v2';

async function getClient(): Promise<AxiosInstance> {
  const tokens = await refreshTokensIfNeeded();
  if (!tokens) throw new Error('No Yahoo tokens found. Authenticate first.');
  const instance = axios.create({
    baseURL: YAHOO_FANTASY_BASE,
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  return instance;
}

// Minimal wrappers; expand as needed.
export async function getUserLeagues(game: 'nfl' | string) {
  const client = await getClient();
  const url = `/users;use_login=1/games;game_keys=${game}/leagues`;
  const { data } = await client.get(url, { headers: { Accept: 'application/json' } });
  return data;
}

export async function getTeamRoster(teamKey: string) {
  const client = await getClient();
  const url = `/team/${teamKey}/roster/players`;
  const { data } = await client.get(url, { headers: { Accept: 'application/json' } });
  return data;
}

export async function setLineup(teamKey: string, payloadXml: string) {
  const client = await getClient();
  // Yahoo Fantasy API uses XML for write operations; payload must be XML.
  const url = `/team/${teamKey}/roster`;
  const { data } = await client.put(url, payloadXml, {
    headers: { 'Content-Type': 'application/xml', Accept: 'application/json' },
  });
  return data;
}

export async function addDropPlayers(teamKey: string, payloadXml: string) {
  const client = await getClient();
  const url = `/team/${teamKey}/players`;
  const { data } = await client.post(url, payloadXml, {
    headers: { 'Content-Type': 'application/xml', Accept: 'application/json' },
  });
  return data;
}

export async function proposeTrade(leagueKey: string, payloadXml: string) {
  const client = await getClient();
  const url = `/league/${leagueKey}/transactions`;
  const { data } = await client.post(url, payloadXml, {
    headers: { 'Content-Type': 'application/xml', Accept: 'application/json' },
  });
  return data;
}

export async function getMatchups(teamKey: string) {
  const client = await getClient();
  const url = `/team/${teamKey}/matchups`;
  const { data } = await client.get(url, { headers: { Accept: 'application/json' } });
  return data;
}

export function logRateLimit(resHeaders: any) {
  const limit = resHeaders?.['x-ratelimit-limit'];
  const remaining = resHeaders?.['x-ratelimit-remaining'];
  if (limit) logger.debug(`Yahoo rate-limit: ${remaining}/${limit}`);
}

export async function getLeagueTeams(leagueKey: string) {
  const client = await getClient();
  const url = `/league/${leagueKey}/teams`;
  const { data } = await client.get(url, { headers: { Accept: 'application/json' } });
  return data;
}

export async function getLeagueFreeAgents(leagueKey: string, start = 0, count = 25) {
  const client = await getClient();
  const url = `/league/${leagueKey}/players;status=FA;start=${start};count=${count}`;
  const { data } = await client.get(url, { headers: { Accept: 'application/json' } });
  return data;
}

export async function getLeagueSettings(leagueKey: string) {
  const client = await getClient();
  const url = `/league/${leagueKey}/settings`;
  const { data } = await client.get(url, { headers: { Accept: 'application/json' } });
  return data;
}
