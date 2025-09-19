import { createHash } from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

export const AUTH_COOKIE_NAME = 'dashboard_auth';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function getPassword(): string {
  return process.env.DASHBOARD_PASSWORD ?? '';
}

function computeToken(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

function headerToCookieString(header: string | string[] | undefined): string {
  if (!header) return '';
  if (Array.isArray(header)) return header.join('; ');
  return header;
}

export function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  const cookieString = headerToCookieString(header);
  if (!cookieString) return output;
  const pairs = cookieString.split(';');
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) output[key] = decodeURIComponent(value);
  }
  return output;
}

export function isPasswordConfigured(): boolean {
  return Boolean(getPassword());
}

export function isAuthorized(header: string | string[] | undefined): boolean {
  const password = getPassword();
  if (!password) return false;
  const cookies = parseCookies(header);
  const expected = computeToken(password);
  return cookies[AUTH_COOKIE_NAME] === expected;
}

function buildCookie(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === 'production';
  const segments = [
    `${AUTH_COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ];
  if (secure) segments.push('Secure');
  return segments.join('; ');
}

export function setAuthCookie(res: NextApiResponse): void {
  const password = getPassword();
  if (!password) throw new Error('DASHBOARD_PASSWORD is not configured');
  const token = computeToken(password);
  res.setHeader('Set-Cookie', buildCookie(token, SESSION_TTL_SECONDS));
}

export function clearAuthCookie(res: NextApiResponse): void {
  res.setHeader('Set-Cookie', buildCookie('', 0));
}

export function requireApiAuth(req: NextApiRequest, res: NextApiResponse): boolean {
  if (isAuthorized(req.headers.cookie)) return true;
  res.status(401).json({ ok: false, error: 'Unauthorized' });
  return false;
}
