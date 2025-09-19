const LEAGUE_KEY_REGEX = /^nfl\.l\.\d+$/i;
const TEAM_KEY_REGEX = /^nfl\.l\.\d+\.t\.\d+$/i;

export function normalizeLeagueKeyInput(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (LEAGUE_KEY_REGEX.test(value)) return value;
  if (/^\d+$/.test(value)) return `nfl.l.${value}`;
  const match = value.match(/(\d{4,})/);
  if (match) return `nfl.l.${match[1]}`;
  return value;
}

export function normalizeTeamKeyInput(leagueKeyMaybe: string | null | undefined, raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (TEAM_KEY_REGEX.test(value)) return value;
  const leagueKey = normalizeLeagueKeyInput(leagueKeyMaybe ?? '');
  if (/^\d+$/.test(value) && leagueKey) return `${leagueKey}.t.${value}`;
  const match = value.match(/(?:^|\.t\.)(\d+)$/i);
  if (match && leagueKey) return `${leagueKey}.t.${match[1]}`;
  return value;
}

export function extractTeamNumber(teamKey: string | null | undefined): number | null {
  if (!teamKey) return null;
  const match = String(teamKey).match(/\.t\.(\d+)$/i);
  if (!match || !match[1]) return null;
  const num = Number.parseInt(match[1], 10);
  return Number.isFinite(num) ? num : null;
}
