import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';

export type TokenBundle = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  xoauth_yahoo_guid?: string;
  obtained_at: number; // epoch seconds
};

const dataDir = path.join(process.cwd(), 'data');
const tokenPath = path.join(dataDir, 'tokens.json');

export function loadTokens(): TokenBundle | null {
  try {
    const raw = fs.readFileSync(tokenPath, 'utf-8');
    return JSON.parse(raw) as TokenBundle;
  } catch (err) {
    return null;
  }
}

export function saveTokens(tokens: Omit<TokenBundle, 'obtained_at'>) {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const bundle: TokenBundle = { ...tokens, obtained_at: Math.floor(Date.now() / 1000) };
    fs.writeFileSync(tokenPath, JSON.stringify(bundle, null, 2));
    logger.info('Saved Yahoo tokens to disk');
  } catch (err) {
    logger.error('Failed to save tokens', err);
  }
}

