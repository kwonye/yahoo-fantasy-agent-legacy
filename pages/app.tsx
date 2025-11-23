import Head from 'next/head';
import type { GetServerSideProps } from 'next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { QuotaError, QuotaSnapshot } from '../src/lib/quota';
import { isAuthorized } from '../src/lib/auth';

export type AppPageProps = {
  initialQuota: QuotaSnapshot | QuotaError | null;
};

export const getServerSideProps: GetServerSideProps<AppPageProps> = async ({ req }) => {
  if (!isAuthorized(req?.headers?.cookie)) {
    return {
      redirect: {
        destination: '/',
        permanent: false,
      },
    };
  }

  let initialQuota: QuotaSnapshot | QuotaError | null = null;
  try {
    const quotaModule = await import('../src/lib/quota');
    initialQuota = quotaModule.getQuotaSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load quota';
    initialQuota = { ok: false, error: message };
  }

  return {
    props: {
      initialQuota,
    },
  };
};

const DEFAULT_FEATURES = {
  kickoffEnabled: false,
  irAutomationEnabled: false,
  waiverAutomationEnabled: false,
  pickupsAutomationEnabled: false,
  tradesAutomationEnabled: false,
  tradeResponsesAutomationEnabled: false,
  debugYahooEnabled: false,
  applyChanges: false,
};

const DEFAULT_SCHEDULE = {
  enabled: false,
  hour: 9,
  minute: 0,
  waiverDay: 2,
  waiverHour: 7,
  waiverMinute: 0,
};

type FeaturesState = typeof DEFAULT_FEATURES;

type ScheduleState = typeof DEFAULT_SCHEDULE;

type UpcomingTask = {
  type: string;
  runAtISO: string;
  details?: string;
  preMinutes?: number;
};

async function fetchJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

const relativeFormatter = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;

function formatRelativeTime(targetISO: string) {
  try {
    const target = new Date(targetISO).getTime();
    const now = Date.now();
    const diffMs = target - now;
    const diffMinutes = Math.round(diffMs / 60000);
    if (!relativeFormatter) return `${diffMinutes} minutes`;
    const absMinutes = Math.abs(diffMinutes);
    if (absMinutes < 60) return relativeFormatter.format(diffMinutes, 'minute');
    const diffHours = Math.round(diffMinutes / 60);
    const absHours = Math.abs(diffHours);
    if (absHours < 48) return relativeFormatter.format(diffHours, 'hour');
    const diffDays = Math.round(diffHours / 24);
    return relativeFormatter.format(diffDays, 'day');
  } catch {
    return '';
  }
}

function maskValue(value?: string | null) {
  if (!value) return '';
  const str = String(value);
  if (str.length <= 4) return '*'.repeat(str.length);
  return `${str.slice(0, 3)}***${str.slice(-2)}`;
}

export default function AppPage({ initialQuota }: AppPageProps) {
  const [health, setHealth] = useState<any>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [credentials, setCredentials] = useState<any>(null);
  const [quota, setQuota] = useState<QuotaSnapshot | QuotaError | null>(initialQuota);
  const [env, setEnv] = useState<{ leagueKey: string; teamKey: string; redirectUri?: string }>({ leagueKey: '', teamKey: '', redirectUri: '' });
  const [schedule, setSchedule] = useState<ScheduleState>(DEFAULT_SCHEDULE);
  const [features, setFeatures] = useState<FeaturesState>(DEFAULT_FEATURES);
  const [featureDraft, setFeatureDraft] = useState<FeaturesState>(DEFAULT_FEATURES);
  const [activity, setActivity] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [geminiLogs, setGeminiLogs] = useState<any[]>([]);
  const [roster, setRoster] = useState<any[]>([]);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [leagueProfile, setLeagueProfile] = useState<any>(null);
  const [upcomingTasks, setUpcomingTasks] = useState<UpcomingTask[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [tradeBlock, setTradeBlock] = useState<{ needs?: string[]; surplus?: string[]; reasoning?: string; counts?: Record<string, number> } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [yahooClientId, setYahooClientId] = useState('');
  const [yahooClientSecret, setYahooClientSecret] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-1.5-pro');
  const [geminiQuota, setGeminiQuota] = useState(250);
  const [leagueKeyInput, setLeagueKeyInput] = useState('');
  const [teamKeyInput, setTeamKeyInput] = useState('');
  const [redirectUriInput, setRedirectUriInput] = useState('');
  const [theirTeamNumber, setTheirTeamNumber] = useState('');

  const [yahooClientTouched, setYahooClientTouched] = useState(false);
  const [yahooSecretTouched, setYahooSecretTouched] = useState(false);
  const [geminiKeyTouched, setGeminiKeyTouched] = useState(false);
  const [geminiModelTouched, setGeminiModelTouched] = useState(false);
  const [geminiQuotaTouched, setGeminiQuotaTouched] = useState(false);
  const [leagueKeyTouched, setLeagueKeyTouched] = useState(false);
  const [teamKeyTouched, setTeamKeyTouched] = useState(false);
  const [redirectTouched, setRedirectTouched] = useState(false);

  const [prompt, setPrompt] = useState('');
  const [promptResult, setPromptResult] = useState('');
  const [previewType, setPreviewType] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState('');

  const [isSavingFeatures, setIsSavingFeatures] = useState(false);
  const [isSendingPrompt, setIsSendingPrompt] = useState(false);
  const [isActivityCollapsed, setActivityCollapsed] = useState(false);
  const [isGeminiCollapsed, setGeminiCollapsed] = useState(false);

  const renderLiteral = useCallback((value: any) => {
    if (value === null || value === undefined) return <span className="text-muted">—</span>;
    if (typeof value === 'string') return <pre className="mono small mb-0">{value}</pre>;
    if (typeof value === 'number' || typeof value === 'boolean') return <span className="mono small">{String(value)}</span>;
    if (Array.isArray(value) && value.every((item) => typeof item !== 'object')) {
      return <span className="mono small">{value.join(', ')}</span>;
    }
    return <pre className="mono small mb-0">{JSON.stringify(value, null, 2)}</pre>;
  }, []);

  const renderActivityDetails = useCallback((event: any) => {
    if (!event || typeof event !== 'object') return renderLiteral(event);

    if (event.decision && typeof event.decision === 'object') {
      const { shouldAccept, confidence, reasoning, ...rest } = event.decision;
      const badges: ReactNode[] = [];
      if (typeof shouldAccept === 'boolean') {
        badges.push(<span key="decision" className={`badge ${shouldAccept ? 'bg-success' : 'bg-danger'}`}>{shouldAccept ? 'Accept' : 'Decline'}</span>);
      }
      if (typeof confidence === 'number') {
        const percent = Math.round(confidence * 100);
        badges.push(<span key="confidence" className="badge bg-light text-dark">Confidence {percent}%</span>);
      }

      return (
        <div className="activity-detail small">
          {badges.length > 0 ? <div className="d-flex flex-wrap gap-2 mb-1">{badges}</div> : null}
          {reasoning ? <div className="text-muted">{reasoning}</div> : null}
          {Object.keys(rest || {}).length ? <div className="mt-2">{renderLiteral(rest)}</div> : null}
        </div>
      );
    }

    const rows: Array<[string, any]> = [];
    if (event.summary) rows.push(['summary', event.summary]);
    if (event.action) rows.push(['action', event.action]);
    if (event.request) rows.push(['request', event.request]);
    if (event.response) rows.push(['response', event.response]);
    if (event.error) rows.push(['error', event.error]);
    if (event.details) rows.push(['details', event.details]);
    if (event.meta) rows.push(['meta', event.meta]);

    if (rows.length === 0) return renderLiteral(event);

    return (
      <dl className="activity-detail small mb-0">
        {rows.map(([label, value], idx) => (
          <div key={`${label}-${idx}`} className="activity-detail-row">
            <dt>{label}</dt>
            <dd>{renderLiteral(value)}</dd>
          </div>
        ))}
      </dl>
    );
  }, [renderLiteral]);

  const renderGeminiEntry = useCallback((log: any, idx: number) => {
    const roles: Array<{ label: string; content: any }> = [
      { label: 'system', content: log?.system },
      { label: 'user', content: log?.user },
      { label: 'assistant', content: log?.response },
    ].filter((role) => role.content !== undefined && role.content !== null && role.content !== '');

    const extras: Array<[string, any]> = [];
    if (log?.tools) extras.push(['tools', log.tools]);
    if (log?.metadata) extras.push(['metadata', log.metadata]);

    return (
      <article key={idx} className="gemini-entry">
        <div className="d-flex justify-content-between align-items-center text-muted small mb-2">
          <span>{formatDateTime(log?.ts)}</span>
          {log?.model ? <span className="mono">{log.model}</span> : null}
        </div>
        {roles.map((role) => (
          <div key={role.label} className={`gemini-message gemini-${role.label}`}>
            <span className="badge bg-light text-dark text-uppercase">{role.label}</span>
            <div className="gemini-bubble">{renderLiteral(role.content)}</div>
          </div>
        ))}
        {extras.length ? (
          <dl className="activity-detail small mb-0 mt-2">
            {extras.map(([label, value], extraIdx) => (
              <div key={`${label}-${extraIdx}`} className="activity-detail-row">
                <dt>{label}</dt>
                <dd>{renderLiteral(value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </article>
    );
  }, [renderLiteral]);

  const leagueTeamDisplay = useMemo(() => {
    const league = leagueKeyInput || env.leagueKey;
    const team = teamKeyInput || env.teamKey;
    return { league, team };
  }, [leagueKeyInput, teamKeyInput, env.leagueKey, env.teamKey]);

  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const tasks: Array<[string, Promise<any>]> = [
        ['health', fetchJson('/api/health').catch(() => null)],
        ['metrics', fetchJson('/api/metrics').catch(() => null)],
        ['creds', fetchJson('/api/creds').catch(() => null)],
        ['yahooRaw', fetchJson('/api/creds/yahoo/raw').catch(() => null)],
        ['geminiRaw', fetchJson('/api/creds/gemini/raw').catch(() => null)],
        ['env', fetchJson('/api/env').catch(() => null)],
        ['features', fetchJson('/api/features').catch(() => null)],
        ['schedule', fetchJson('/api/schedule').catch(() => null)],
        ['schedulePreview', fetchJson('/api/schedule/preview').catch(() => null)],
        ['activity', fetchJson('/api/activity?limit=200').catch(() => null)],
        ['geminiLogs', fetchJson('/api/gemini/logs').catch(() => null)],
        ['roster', fetchJson('/api/roster').catch((error) => ({ ok: false, error: error instanceof Error ? error.message : 'Failed to load roster' }))],
        ['leagueProfile', fetchJson('/api/league-config').catch(() => null)],
        ['trades', fetchJson('/api/trades/incoming?debug=1').catch(() => null)],
        ['tradeBlock', fetchJson('/api/trade-block').catch(() => null)],
        ['quota', fetchJson('/api/quota').catch((error) => ({ ok: false, error: error instanceof Error ? error.message : 'Failed to load quota' }))],
      ];

      const results = await Promise.all(tasks.map(async ([key, promise]) => {
        const value = await promise;
        return [key, value] as [string, any];
      }));
      const map = Object.fromEntries(results) as Record<string, any>;

      setHealth(map.health?.status ? map.health : map.health);
      setMetrics(map.metrics?.metrics ?? map.metrics ?? null);
      setCredentials(map.creds ?? null);
      if (map.quota && typeof map.quota === 'object') setQuota(map.quota as QuotaSnapshot | QuotaError);

      if (map.env && map.env.ok !== false) {
        const nextEnv = {
          leagueKey: map.env.leagueKey || '',
          teamKey: map.env.teamKey || '',
          redirectUri: map.env.redirectUri || '',
        };
        setEnv(nextEnv);
        if (!leagueKeyTouched) setLeagueKeyInput(nextEnv.leagueKey);
        if (!teamKeyTouched) setTeamKeyInput(nextEnv.teamKey);
        if (!redirectTouched) setRedirectUriInput(nextEnv.redirectUri || '');
      }

      if (map.features?.features) {
        const merged = { ...DEFAULT_FEATURES, ...map.features.features } as FeaturesState;
        setFeatures(merged);
        setFeatureDraft(merged);
      }

      if (map.schedule?.schedule) {
        setSchedule({ ...DEFAULT_SCHEDULE, ...map.schedule.schedule });
      }

      if (map.schedulePreview && map.schedulePreview.ok !== false) {
        const tasksList: UpcomingTask[] = [];
        const waiver = map.schedulePreview.waiver;
        if (waiver?.enabled && waiver.nextRunISO) {
          tasksList.push({ type: 'Waiver Processing', runAtISO: waiver.nextRunISO, details: waiver.source });
        }
        const kickoff = map.schedulePreview.kickoff;
        if (kickoff?.enabled && Array.isArray(kickoff.upcoming)) {
          kickoff.upcoming.slice(0, 10).forEach((item: any) => {
            tasksList.push({
              type: 'Kickoff Check',
              runAtISO: item.runAtISO,
              details: item.note ? `${item.note} • kickoff ${new Date(item.kickoffISO).toLocaleTimeString()}` : undefined,
              preMinutes: item.preMinutes,
            });
          });
        }
        const tradeEval = map.schedulePreview.tradeEval;
        if (tradeEval?.enabled && tradeEval.nextRunISO) {
          tasksList.push({ type: 'Trade Evaluation', runAtISO: tradeEval.nextRunISO, details: `Daily at ${String(tradeEval.hour).padStart(2, '0')}:${String(tradeEval.minute).padStart(2, '0')}` });
        }
        tasksList.sort((a, b) => new Date(a.runAtISO).getTime() - new Date(b.runAtISO).getTime());
        setUpcomingTasks(tasksList);
      }

      if (map.activity?.events) {
        const events = Array.isArray(map.activity.events) ? map.activity.events : [];
        setActivity(events.slice().reverse());
        const applied = events.filter((ev: any) => ev?.type === 'action' && /applied/.test(String(ev.action || '')));
        setTransactions(applied.slice(-20).reverse());
      }

      setGeminiLogs(Array.isArray(map.geminiLogs?.logs) ? map.geminiLogs.logs.slice().reverse() : []);
      if (map.roster && map.roster.ok === false) {
        setRoster([]);
        setRosterError(map.roster.error || 'Failed to load roster');
      } else if (Array.isArray(map.roster?.roster)) {
        setRoster(map.roster.roster);
        setRosterError(null);
      }
      setLeagueProfile(map.leagueProfile?.profile ?? null);
      setTrades(Array.isArray(map.trades?.trades) ? map.trades.trades : []);
      setTradeBlock(map.tradeBlock?.ok ? map.tradeBlock : null);

      if (map.creds?.creds) {
        const masked = {
          yahoo: map.creds.creds.yahoo,
          gemini: map.creds.creds.gemini,
        };
        setCredentials(masked);
      }

      if (map.yahooRaw?.ok) {
        if (!yahooClientTouched) setYahooClientId(map.yahooRaw.clientId || '');
        if (!yahooSecretTouched) setYahooClientSecret(map.yahooRaw.clientSecret || '');
      }
      if (map.geminiRaw?.ok) {
        if (!geminiKeyTouched) setGeminiApiKey(map.geminiRaw.apiKey || '');
        if (!geminiModelTouched) setGeminiModel(map.geminiRaw.model || 'gemini-1.5-pro');
        if (!geminiQuotaTouched) {
          const rawQ = map.geminiRaw.geminiQuota;
          // Upgrade legacy 200 to 250
          setGeminiQuota(Number(rawQ));
        }
      }

      if (typeof window !== 'undefined') {
        try {
          const storedLeague = window.localStorage.getItem('leagueKey');
          if (storedLeague) {
            setLeagueKeyInput(storedLeague);
            setLeagueKeyTouched(true);
          }
          const storedTeam = window.localStorage.getItem('teamKey');
          if (storedTeam) {
            setTeamKeyInput(storedTeam);
            setTeamKeyTouched(true);
          }
        } catch {
          // ignore storage errors
        }
      }

      setLastUpdated(new Date().toISOString());
    } finally {
      setIsRefreshing(false);
    }
  }, [geminiKeyTouched, geminiModelTouched, geminiQuotaTouched, leagueKeyTouched, teamKeyTouched, yahooClientTouched, yahooSecretTouched]);

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveYahoo = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = { clientId: yahooClientId, clientSecret: yahooClientSecret };
    const result = await fetchJson('/api/creds/yahoo', { method: 'POST', body: JSON.stringify(body) });
    if ((result as any)?.ok) {
      alert('Yahoo credentials saved');
      setYahooClientTouched(false);
      setYahooSecretTouched(false);
      refreshAll();
    } else {
      alert(`Save failed: ${(result as any)?.error || 'unknown'}`);
    }
  }, [yahooClientId, yahooClientSecret, refreshAll]);

  const handleSaveGemini = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = { apiKey: geminiApiKey, model: geminiModel, geminiQuota: geminiQuota };
    const result = await fetchJson('/api/creds/gemini', { method: 'POST', body: JSON.stringify(body) });
    if ((result as any)?.ok) {
      alert('Gemini settings saved');
      setGeminiKeyTouched(false);
      setGeminiModelTouched(false);
      setGeminiQuotaTouched(false);
      refreshAll();
    } else {
      alert(`Save failed: ${(result as any)?.error || 'unknown'}`);
    }
  }, [geminiApiKey, geminiModel, geminiQuota, refreshAll]);

  const handleSaveKeys = useCallback(async () => {
    const body = { leagueKey: leagueKeyInput, teamKey: teamKeyInput, redirectUri: redirectUriInput };
    const result = await fetchJson('/api/env', { method: 'POST', body: JSON.stringify(body) });
    if ((result as any)?.ok) {
      alert('Keys saved');
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem('leagueKey', leagueKeyInput);
          window.localStorage.setItem('teamKey', teamKeyInput);
        } catch {}
      }
      refreshAll();
    } else {
      alert(`Save failed: ${(result as any)?.error || 'unknown'}`);
    }
  }, [leagueKeyInput, teamKeyInput, redirectUriInput, refreshAll]);

  const handleRun = useCallback(async (endpoint: string, label: string) => {
    const aliases: Record<string, string> = {
      '/api/bot/kickoff': '/api/run/kickoff',
      '/api/bot/ir': '/api/run/ir',
      '/api/bot/waivers': '/api/run/waivers',
      '/api/bot/pickups': '/api/run/pickups',
    };
    const leagueKey = leagueTeamDisplay.league;
    const teamKey = leagueTeamDisplay.team;
    if (!leagueKey || !teamKey) {
      alert('Set league and team keys first');
      return;
    }
    const target = aliases[endpoint] ?? endpoint;
    const result = await fetchJson(target, { method: 'POST', body: JSON.stringify({ leagueKey, teamKey }) }).catch(() => ({ ok: false }));
    const outcome = (result as any)?.result?.outcome as string | undefined;
    const outcomeMessage = (result as any)?.result?.message as string | undefined;
    const errorMessage = (result as any)?.error as string | undefined;
    if ((result as any)?.ok) {
      const suffix = outcome === 'dry_run' ? ' (dry run)' : '';
      const extra = outcomeMessage ? `: ${outcomeMessage}` : '';
      alert(`${label} completed${suffix}${extra}`);
      refreshAll();
    } else {
      const msg = errorMessage || outcomeMessage || 'unknown';
      alert(`${label} failed: ${msg}`);
    }
  }, [leagueTeamDisplay, refreshAll]);

  const handleClearActivity = useCallback(async () => {
    await fetchJson('/api/logs/clear', { method: 'POST' });
    refreshAll();
  }, [refreshAll]);

  const handleClearGemini = useCallback(async () => {
    await fetchJson('/api/gemini/clear', { method: 'POST' });
    refreshAll();
  }, [refreshAll]);

  const handleSaveFeatures = useCallback(async () => {
    setIsSavingFeatures(true);
    try {
      const result = await fetchJson('/api/features', { method: 'POST', body: JSON.stringify(featureDraft) });
      if ((result as any)?.ok) {
        alert('Automation settings saved');
        setFeatures(result.features || featureDraft);
      } else {
        alert(`Save failed: ${(result as any)?.error || 'unknown'}`);
      }
    } finally {
      setIsSavingFeatures(false);
      refreshAll();
    }
  }, [featureDraft, refreshAll]);

  const handleRespondTrade = useCallback(async (tradeId: string, accept: boolean) => {
    const leagueKey = leagueTeamDisplay.league;
    if (!leagueKey) { alert('Set league key first'); return; }
    const result = await fetchJson('/api/trades/respond', { method: 'POST', body: JSON.stringify({ leagueKey, tradeId, accept }) });
    if ((result as any)?.ok) {
      alert(accept ? 'Trade accepted' : 'Trade declined');
      refreshAll();
    } else {
      alert(`Action failed: ${(result as any)?.error || 'unknown'}`);
    }
  }, [leagueTeamDisplay, refreshAll]);

  const handleEvaluateTrade = useCallback(async (tradeId: string) => {
    const leagueKey = leagueTeamDisplay.league;
    const teamKey = leagueTeamDisplay.team;
    if (!leagueKey || !teamKey) { alert('Set league and team keys first'); return; }
    const result = await fetchJson('/api/trades/evaluate', { method: 'POST', body: JSON.stringify({ leagueKey, teamKey, tradeId }) });
    if ((result as any)?.ok) {
      const decision = (result as any).decision;
      alert(`Gemini suggests: ${decision.shouldAccept ? 'ACCEPT' : 'DECLINE'}\nConfidence: ${Math.round((decision.confidence || 0) * 100)}%\nReasoning: ${decision.reasoning}`);
    } else {
      alert(`Evaluate failed: ${(result as any)?.error || 'unknown'}`);
    }
  }, [leagueTeamDisplay]);

  const handleRefreshTrades = useCallback(async () => {
    const result = await fetchJson('/api/trades/incoming?debug=1').catch(() => ({ trades: [] }));
    setTrades(Array.isArray((result as any).trades) ? (result as any).trades : []);
  }, []);

  const handleRefreshTradeBlock = useCallback(async () => {
    const result = await fetchJson('/api/trade-block?force=1').catch(() => null);
    if (result && (result as any).ok) setTradeBlock(result as any);
    else alert(`Unable to refresh trade block: ${(result as any)?.error || 'unknown'}`);
  }, []);

  const handleSendPrompt = useCallback(async () => {
    if (!prompt.trim()) return;
    setIsSendingPrompt(true);
    try {
      const result = await fetchJson('/api/gemini/test', { method: 'POST', body: JSON.stringify({ prompt }) });
      if ((result as any)?.ok) {
        setPromptResult((result as any).response || '');
        refreshAll();
      } else {
        setPromptResult(`Error: ${(result as any)?.error || 'unknown'}`);
      }
    } finally {
      setIsSendingPrompt(false);
    }
  }, [prompt, refreshAll]);

  const handlePreviewPrompt = useCallback(async (kind: 'lineup' | 'waivers' | 'trade') => {
    const leagueKey = leagueTeamDisplay.league;
    const teamKey = leagueTeamDisplay.team;
    if (!leagueKey || !teamKey) { alert('Set league and team keys first'); return; }
    const payload: Record<string, unknown> = { type: kind, leagueKey, teamKey };
    if (kind === 'trade' && theirTeamNumber.trim()) payload.theirTeamNumber = Number(theirTeamNumber.trim());
    const result = await fetchJson('/api/gemini/preview', { method: 'POST', body: JSON.stringify(payload) }).catch(() => ({ ok: false }));
    if ((result as any)?.ok) {
      setPreviewType(kind);
      setPreviewText(`SYSTEM\n${(result as any).system}\n\nUSER\n${(result as any).user}`);
    } else {
      setPreviewType(kind);
      setPreviewText(`Error: ${(result as any)?.error || 'unknown'}`);
    }
  }, [leagueTeamDisplay, theirTeamNumber]);

  const handleUpdateDeploy = useCallback(async () => {
    const result = await fetchJson('/api/update-deploy', { method: 'POST' });
    if ((result as any)?.ok) {
      alert('Deployment initiated!');
    } else {
      alert(`Deployment failed: ${(result as any)?.error || 'unknown'}`);
    }
  }, []);

  const modeBadgeText = features.applyChanges ? 'Mode: Live Writes' : 'Mode: Dry Run';
  const modeBadgeClass = features.applyChanges ? 'badge bg-danger' : 'badge bg-secondary';
  const yahooBadgeClass = credentials?.yahoo ? 'badge bg-success' : 'badge bg-warning text-dark';
  const geminiBadgeClass = credentials?.gemini ? 'badge bg-success' : 'badge bg-warning text-dark';
  const yahooBadgeText = credentials?.yahoo ? `Yahoo: ${maskValue(credentials.yahoo.clientId)}` : 'Yahoo: Missing';
  const geminiBadgeText = credentials?.gemini ? `Gemini: ${maskValue(credentials.gemini.apiKey)}` : 'Gemini: Missing';
  const quotaBadgeText = quota
    ? quota.ok === false
      ? 'Quota: ⚠️'
      : `Quota: ${quota.remaining ?? '—'}/${quota.limit ?? '—'}`
    : 'Quota: —';
  const quotaBadgeTitle = quota
    ? quota.ok === false
      ? `Quota unavailable: ${quota.error || 'Unknown error'}`
      : quota.resetsAt
        ? `Resets ${formatDateTime(quota.resetsAt)}`
        : 'Quota data loaded'
    : 'Quota data pending';
  const quotaRemaining = quota && quota.ok !== false ? quota.remaining : null;
  const quotaBadgeClass = quotaRemaining !== null && quotaRemaining > 0 ? 'badge bg-success' : 'badge bg-warning text-dark';

  return (
    <>
      <Head>
        <title>Fantasy Football Bot Dashboard</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" />
      </Head>
      <main className="dashboard-bg">
        <nav className="navbar navbar-expand-lg mb-3 shadow-sm">
          <div className="container-fluid justify-content-between">
            <span className="navbar-brand fw-semibold">Fantasy Football Bot</span>
            <div className="d-flex flex-wrap gap-2">
              <span className={modeBadgeClass}>{modeBadgeText}</span>
              <span className={yahooBadgeClass}>{yahooBadgeText}</span>
              <span className={geminiBadgeClass}>{geminiBadgeText}</span>
              <span className={quotaBadgeClass} title={quotaBadgeTitle}>{quotaBadgeText}</span>
            </div>
          </div>
        </nav>

        <div className="container-fluid">
          <div className="row g-3">
            <div className="col-lg-4 col-md-6 col-12">
              <div className="row g-3">
                <div className="col-12"><DashboardCard title="Health"><pre className="mono mb-0">{health ? JSON.stringify(health, null, 2) : 'Loading…'}</pre></DashboardCard></div>
                <div className="col-12"><DashboardCard title="Metrics"><pre className="mono mb-0">{metrics ? JSON.stringify(metrics, null, 2) : 'Loading…'}</pre></DashboardCard></div>
                <div className="col-12">
                  <DashboardCard title="Credentials">
                    <div className="mb-2"><span className="badge bg-light text-dark me-2">Yahoo</span>{yahooBadgeText}</div>
                    <div className="mb-3"><span className="badge bg-light text-dark me-2">Gemini</span>{geminiBadgeText}</div>
                    <form className="mono" onSubmit={handleSaveYahoo}>
                      <div className="mb-2">
                        <label className="form-label">Yahoo Client ID</label>
                        <input value={yahooClientId} onChange={(e) => { setYahooClientId(e.target.value); setYahooClientTouched(true); }} className="form-control form-control-sm" type="password" />
                      </div>
                      <div className="mb-2">
                        <label className="form-label">Yahoo Client Secret</label>
                        <input value={yahooClientSecret} onChange={(e) => { setYahooClientSecret(e.target.value); setYahooSecretTouched(true); }} className="form-control form-control-sm" type="password" />
                      </div>
                      <div className="d-flex gap-2">
                        <button type="submit" className="btn btn-sm btn-secondary">Save Yahoo Creds</button>
                        <a className="btn btn-sm btn-outline-primary" href="/auth/yahoo/start" target="_blank" rel="noopener noreferrer">Connect Yahoo</a>
                      </div>
                    </form>
                    <hr />
                    <form className="mono" onSubmit={handleSaveGemini}>
                      <div className="mb-2">
                        <label className="form-label">Gemini API Key</label>
                        <input value={geminiApiKey} onChange={(e) => { setGeminiApiKey(e.target.value); setGeminiKeyTouched(true); }} className="form-control form-control-sm" type="password" />
                      </div>
                      <div className="mb-2">
                        <label className="form-label">Gemini Model</label>
                        <input value={geminiModel} onChange={(e) => { setGeminiModel(e.target.value); setGeminiModelTouched(true); }} className="form-control form-control-sm" />
                      </div>
                      <div className="mb-3">
                        <label className="form-label">Gemini Quota</label>
                        <input value={geminiQuota} onChange={(e) => { setGeminiQuota(Number(e.target.value)); setGeminiQuotaTouched(true); }} className="form-control form-control-sm" type="number" />
                      </div>
                      <button type="submit" className="btn btn-sm btn-secondary">Save Gemini Settings</button>
                    </form>
                  </DashboardCard>
                </div>
                <div className="col-12">
                  <DashboardCard title="League Setup">
                    <div className="row g-2">
                      <div className="col-12">
                        <label className="form-label">League Key</label>
                        <div className="input-group input-group-sm">
                          <span className="input-group-text">nfl.l.</span>
                          <input
                            className="form-control"
                            value={leagueKeyInput.replace(/^nfl\.l\./i, '')}
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              if (!raw) {
                                setLeagueKeyInput('');
                              } else if (raw.startsWith('nfl.l.')) {
                                setLeagueKeyInput(raw);
                              } else {
                                setLeagueKeyInput(`nfl.l.${raw}`);
                              }
                              setLeagueKeyTouched(true);
                            }}
                          />
                        </div>
                      </div>
                      <div className="col-12">
                        <label className="form-label">Team Key</label>
                        <div className="input-group input-group-sm">
                          <span className="input-group-text">.t.</span>
                          <input
                            className="form-control"
                            value={teamKeyInput.replace(/^.*\.t\./i, '')}
                            onChange={(e) => {
                              const digits = (leagueKeyInput.match(/\d+/g) || []).join('');
                              const base = digits ? `nfl.l.${digits}` : '';
                              setTeamKeyInput(base ? `${base}.t.${e.target.value}` : e.target.value);
                              setTeamKeyTouched(true);
                            }}
                          />
                        </div>
                      </div>
                      <div className="col-12">
                        <label className="form-label">Redirect URI</label>
                        <input className="form-control form-control-sm" value={redirectUriInput} onChange={(e) => { setRedirectUriInput(e.target.value); setRedirectTouched(true); }} placeholder="https://localhost:3000/auth/yahoo/callback" />
                      </div>
                    </div>
                    <div className="d-flex gap-2 mt-3">
                      <button className="btn btn-sm btn-secondary" onClick={handleSaveKeys} type="button">Save Keys</button>
                      <button className="btn btn-sm btn-outline-primary" onClick={() => handleRun('/api/bot/run', 'Daily run')} type="button">Run Bot Now</button>
                    </div>
                  </DashboardCard>
                </div>
                <div className="col-12">
                  <DashboardCard title="Automation">
                    <div className="form-check form-switch mb-2">
                      <input className="form-check-input" type="checkbox" id="feature-kickoff" checked={featureDraft.kickoffEnabled} onChange={(e) => setFeatureDraft({ ...featureDraft, kickoffEnabled: e.target.checked })} />
                      <label className="form-check-label" htmlFor="feature-kickoff">Enable Kickoff Checks</label>
                    </div>
                    <div className="form-check form-switch mb-2">
                      <input className="form-check-input" type="checkbox" id="feature-ir" checked={featureDraft.irAutomationEnabled} onChange={(e) => setFeatureDraft({ ...featureDraft, irAutomationEnabled: e.target.checked })} />
                      <label className="form-check-label" htmlFor="feature-ir">Enable IR Hygiene</label>
                    </div>
                    <div className="form-check form-switch mb-2">
                      <input className="form-check-input" type="checkbox" id="feature-waivers" checked={featureDraft.waiverAutomationEnabled} onChange={(e) => setFeatureDraft({ ...featureDraft, waiverAutomationEnabled: e.target.checked })} />
                      <label className="form-check-label" htmlFor="feature-waivers">Enable Auto Waivers</label>
                    </div>
                    <div className="form-check form-switch mb-2">
                      <input className="form-check-input" type="checkbox" id="feature-pickups" checked={featureDraft.pickupsAutomationEnabled} onChange={(e) => setFeatureDraft({ ...featureDraft, pickupsAutomationEnabled: e.target.checked })} />
                      <label className="form-check-label" htmlFor="feature-pickups">Enable Auto Pickups</label>
                    </div>
                    <div className="form-check form-switch mb-2 d-flex align-items-center justify-content-between">
                      <div>
                        <input className="form-check-input" type="checkbox" id="feature-trades" checked={featureDraft.tradesAutomationEnabled} onChange={(e) => setFeatureDraft({ ...featureDraft, tradesAutomationEnabled: e.target.checked })} />
                        <label className="form-check-label ms-2" htmlFor="feature-trades">Enable Auto Trade Evaluations</label>
                      </div>
                      <button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => handleRun('/api/run/trades/evaluate', 'Trade evaluation')}>Evaluate Trades</button>
                    </div>
                    <div className="form-check form-switch mb-2 d-flex align-items-center justify-content-between">
                      <div>
                        <input className="form-check-input" type="checkbox" id="feature-trade-responses" checked={featureDraft.tradeResponsesAutomationEnabled} onChange={(e) => setFeatureDraft({ ...featureDraft, tradeResponsesAutomationEnabled: e.target.checked })} />
                        <label className="form-check-label ms-2" htmlFor="feature-trade-responses">Enable Auto Trade Responses</label>
                      </div>
                      <button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => handleRun('/api/run/trades/respond', 'Trade responses')}>Respond to Trades</button>
                    </div>
                    <div className="form-check form-switch mb-2">
                      <input className="form-check-input" type="checkbox" id="feature-debug" checked={featureDraft.debugYahooEnabled} onChange={(e) => setFeatureDraft({ ...featureDraft, debugYahooEnabled: e.target.checked })} />
                      <label className="form-check-label" htmlFor="feature-debug">Enable Debug Logs</label>
                    </div>
                    <div className="form-check form-switch mb-3 d-flex align-items-center justify-content-between">
                      <div>
                        <input className="form-check-input" type="checkbox" id="feature-apply" checked={featureDraft.applyChanges} onChange={(e) => setFeatureDraft({ ...featureDraft, applyChanges: e.target.checked })} />
                        <label className="form-check-label ms-2" htmlFor="feature-apply">Apply Changes</label>
                      </div>
                      <span className="badge bg-warning text-dark">⚠️ Live Mode</span>
                    </div>
                    <button className="btn btn-sm btn-outline-success" disabled={isSavingFeatures} onClick={handleSaveFeatures} type="button">{isSavingFeatures ? 'Saving…' : 'Save Settings'}</button>
                  </DashboardCard>
                </div>
                <div className="col-12">
                  <DashboardCard title="Quick Actions">
                    <div className="d-flex flex-column gap-2">
                      <button className="btn btn-sm btn-outline-primary" onClick={() => handleRun('/api/bot/kickoff', 'Kickoff check')} type="button">Run Kickoff Check</button>
                      <button className="btn btn-sm btn-outline-primary" onClick={() => handleRun('/api/bot/ir', 'IR hygiene')} type="button">Run IR Hygiene</button>
                      <button className="btn btn-sm btn-outline-primary" onClick={() => handleRun('/api/bot/waivers', 'Waivers')} type="button">Run Waivers</button>
                      <button className="btn btn-sm btn-outline-primary" onClick={() => handleRun('/api/bot/pickups', 'Pickups')} type="button">Run Pickups</button>
                      <button className="btn btn-sm btn-outline-primary" onClick={() => handleRun('/api/run/trades/evaluate', 'Trade evaluation')} type="button">Evaluate Trades</button>
                      <button className="btn btn-sm btn-outline-primary" onClick={() => handleRun('/api/run/trades/respond', 'Trade responses')} type="button">Respond to Trades</button>
                      <button className="btn btn-sm btn-outline-warning" onClick={() => handleUpdateDeploy()} type="button">Update & Deploy</button>
                    </div>
                  </DashboardCard>
                </div>
              </div>
            </div>

            <div className="col-lg-8 col-md-6 col-12">
              <div className="row g-3">
                <div className="col-12">
                  <DashboardCard title="Recent Activity" subtitle={lastUpdated ? `Last updated ${formatDateTime(lastUpdated)}` : undefined} actions={
                    <div className="d-flex gap-2">
                      <button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => setActivityCollapsed((prev) => !prev)}>{isActivityCollapsed ? 'Expand' : 'Collapse'}</button>
                      <button className="btn btn-sm btn-outline-secondary" onClick={refreshAll} disabled={isRefreshing} type="button">{isRefreshing ? 'Refreshing…' : 'Refresh'}</button>
                      <button className="btn btn-sm btn-outline-danger" onClick={handleClearActivity} type="button">Clear Activity</button>
                    </div>
                  }>
                    {isActivityCollapsed ? (
                      <div className="text-muted small fst-italic">Activity hidden</div>
                    ) : (
                      <div className="table-responsive" style={{ maxHeight: 320 }}>
                        <table className="table table-sm table-striped align-middle">
                          <thead><tr><th>Time</th><th>Type</th><th>Details</th></tr></thead>
                          <tbody>
                            {activity.length === 0 ? (
                              <tr><td colSpan={3} className="text-center text-muted">No activity yet.</td></tr>
                            ) : activity.map((event, idx) => (
                              <tr key={idx}>
                                <td className="mono small">{formatDateTime(event.ts || event.time)}</td>
                                <td><span className="badge bg-light text-dark text-uppercase">{event.type || 'log'}</span></td>
                                <td>{renderActivityDetails(event)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </DashboardCard>
                </div>

                <div className="col-12">
                  <DashboardCard title="Gemini Activity" actions={
                    <div className="d-flex gap-2">
                      <button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => setGeminiCollapsed((prev) => !prev)}>{isGeminiCollapsed ? 'Expand' : 'Collapse'}</button>
                      <button className="btn btn-sm btn-outline-secondary" onClick={refreshAll} type="button">Refresh</button>
                      <button className="btn btn-sm btn-outline-danger" onClick={handleClearGemini} type="button">Clear</button>
                    </div>
                  }>
                    {isGeminiCollapsed ? (
                      <div className="text-muted small fst-italic">Gemini log hidden</div>
                    ) : (
                      <div className="gemini-log">
                        {geminiLogs.length === 0 ? (
                          <div className="text-muted">No logged Gemini conversations yet.</div>
                        ) : geminiLogs.map((item, idx) => renderGeminiEntry(item, idx))}
                      </div>
                    )}
                  </DashboardCard>
                </div>

                <div className="col-12">
                  <DashboardCard title="Ask Gemini">
                    <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
                      <div className="input-group input-group-sm" style={{ maxWidth: 640 }}>
                        <span className="input-group-text">Prompt</span>
                        <input className="form-control" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask Gemini..." />
                        <button className="btn btn-primary" type="button" onClick={handleSendPrompt} disabled={isSendingPrompt}>{isSendingPrompt ? 'Sending…' : 'Send'}</button>
                      </div>
                      <button className="btn btn-sm btn-outline-primary" type="button" onClick={() => handlePreviewPrompt('lineup')}>Preview lineup prompt</button>
                      <button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => handlePreviewPrompt('waivers')}>Preview waivers prompt</button>
                      <button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => handlePreviewPrompt('trade')}>Preview trade prompt</button>
                    </div>
                    <div className="row g-2">
                      <div className="col-12 col-md-6">
                        <label className="form-label small">Opponent Team #</label>
                        <input className="form-control form-control-sm" type="number" min={1} max={20} value={theirTeamNumber} onChange={(e) => setTheirTeamNumber(e.target.value)} />
                      </div>
                    </div>
                    {promptResult ? <pre className="mono mt-3">{promptResult}</pre> : null}
                    {previewType ? <pre className="mono mt-3">{previewText}</pre> : null}
                  </DashboardCard>
                </div>

                <div className="col-12">
                  <DashboardCard title="Current Roster">
                    <div className="table-responsive" style={{ maxHeight: 320 }}>
                      <table className="table table-sm table-striped mono">
                        <thead><tr><th>Slot</th><th>Pos</th><th>Player</th><th>Team</th><th>Status</th></tr></thead>
                        <tbody>
                          {roster.length === 0 ? (
                            <tr><td colSpan={5} className="text-center text-muted">{rosterError ?? 'Roster not loaded.'}</td></tr>
                          ) : roster.map((entry, idx) => (
                            <tr key={idx}>
                              <td>{entry.slot || '—'}</td>
                              <td>{entry.player?.position}</td>
                              <td>{entry.player?.name}</td>
                              <td>{entry.player?.team}</td>
                              <td>{entry.player?.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </DashboardCard>
                </div>

                <div className="col-12">
                  <DashboardCard title="League Profile">
                    <pre className="mono mb-0" style={{ maxHeight: 320, overflow: 'auto' }}>{leagueProfile ? JSON.stringify(leagueProfile, null, 2) : 'No profile loaded.'}</pre>
                  </DashboardCard>
                </div>

                <div className="col-12">
                  <DashboardCard title="Upcoming Tasks">
                    <div className="table-responsive">
                      <table className="table table-sm table-striped">
                        <thead><tr><th>Action</th><th>Scheduled Time</th><th>Details</th></tr></thead>
                        <tbody>
                          {upcomingTasks.length === 0 ? (
                            <tr><td colSpan={3} className="text-center text-muted">No scheduled tasks</td></tr>
                          ) : upcomingTasks.map((task, idx) => (
                            <tr key={idx}>
                              <td><span className="badge bg-primary">{task.type}</span></td>
                              <td>
                                <div className="fw-semibold">{formatDateTime(task.runAtISO)}</div>
                                <div className="text-muted small">{formatRelativeTime(task.runAtISO)}</div>
                              </td>
                              <td className="small">{task.preMinutes ? `T-${task.preMinutes}m` : ''} {task.details}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </DashboardCard>
                </div>

                <div className="col-12">
                  <DashboardCard title="Incoming Trades" actions={<div className="d-flex gap-2"><button className="btn btn-sm btn-outline-secondary" onClick={handleRefreshTrades}>Refresh</button><button className="btn btn-sm btn-outline-secondary" onClick={handleRefreshTradeBlock}>Refresh Trade Block</button></div>}>
                    <div className="table-responsive">
                      <table className="table table-sm table-striped mono">
                        <thead><tr><th>ID</th><th>Status</th><th>Actions</th></tr></thead>
                        <tbody>
                          {trades.length === 0 ? (
                            <tr><td colSpan={3} className="text-center text-muted">No pending trades.</td></tr>
                          ) : trades.map((trade, idx) => (
                            <tr key={idx}>
                              <td>{trade.id}</td>
                              <td>{trade.status || 'pending'}</td>
                              <td className="d-flex flex-wrap gap-1">
                                <button className="btn btn-sm btn-outline-secondary" onClick={() => alert(JSON.stringify(trade, null, 2))} type="button">View</button>
                                <button className="btn btn-sm btn-outline-primary" onClick={() => handleEvaluateTrade(trade.id)} type="button">Evaluate</button>
                                <button className="btn btn-sm btn-outline-success" onClick={() => handleRespondTrade(trade.id, true)} type="button">Accept</button>
                                <button className="btn btn-sm btn-outline-danger" onClick={() => handleRespondTrade(trade.id, false)} type="button">Decline</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3">
                      <h6 className="fw-semibold">Trade Block</h6>
                      {tradeBlock ? (
                        <pre className="mono mb-0" style={{ maxHeight: 200, overflow: 'auto' }}>{JSON.stringify({ needs: tradeBlock.needs || [], surplus: tradeBlock.surplus || [], reasoning: tradeBlock.reasoning || '', counts: tradeBlock.counts || {} }, null, 2)}</pre>
                      ) : (
                        <div className="text-muted">Trade block not available.</div>
                      )}
                    </div>
                  </DashboardCard>
                </div>

                <div className="col-12">
                  <DashboardCard title="Transactions Summary">
                    <div className="table-responsive" style={{ maxHeight: 240 }}>
                      <table className="table table-sm table-striped mono">
                        <thead><tr><th>Time</th><th>Action</th><th>Details</th></tr></thead>
                        <tbody>
                          {transactions.length === 0 ? (
                            <tr><td colSpan={3} className="text-center text-muted">No recent transactions</td></tr>
                          ) : transactions.map((tx, idx) => (
                            <tr key={idx}>
                              <td>{formatDateTime(tx.ts)}</td>
                              <td>{tx.action}</td>
                              <td><code>{JSON.stringify(tx.details || tx.meta || {})}</code></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </DashboardCard>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <style jsx global>{`
        body { background: #f7f1ff; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .dashboard-bg { padding: 16px; }
        .navbar { background: linear-gradient(180deg, #faf5ff, #fff0f7); border-radius: 12px; border: 1px solid #eadcf8; }
        .navbar-brand { color: #7c3aed; }
        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 13px; white-space: pre-wrap; }
        .badge { font-weight: 600; }
        .card { background: #ffffff; border: 1px solid #eadcf8; box-shadow: 0 6px 18px rgba(167,139,250,0.08); border-radius: 14px; }
        .card-header { background: linear-gradient(180deg, #faf5ff, #fff0f7); border-bottom: 1px solid #eadcf8; font-weight: 600; font-size: 14px; border-top-left-radius: 14px; border-top-right-radius: 14px; }
        .gemini-log { max-height: 260px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
        .activity-detail { width: 100%; }
        .activity-detail-row { display: flex; gap: 0.75rem; align-items: flex-start; margin-bottom: 4px; }
        .activity-detail-row:last-of-type { margin-bottom: 0; }
        .activity-detail-row dt { min-width: 72px; margin-bottom: 0; text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.04em; color: #6b7280; }
        .activity-detail-row dd { margin: 0; flex: 1; }
        .gemini-entry { border: 1px solid #ede9fe; border-radius: 10px; padding: 12px; background: #faf5ff; }
        .gemini-message { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
        .gemini-message:last-of-type { margin-bottom: 0; }
        .gemini-bubble { border-radius: 8px; background: #ffffff; padding: 8px 12px; border: 1px solid #e0e7ff; }
        .gemini-message.gemini-user .gemini-bubble { background: #e0f2fe; border-color: #bae6fd; }
        .gemini-message.gemini-assistant .gemini-bubble { background: #ede9fe; border-color: #d8b4fe; }
        .gemini-message.gemini-system .gemini-bubble { background: #fef3c7; border-color: #fde68a; }
      `}</style>
    </>
  );
}

type DashboardCardProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
};

function DashboardCard({ title, subtitle, actions, children }: DashboardCardProps) {
  return (
    <div className="card">
      <div className="card-header d-flex justify-content-between align-items-center">
        <div>
          <div>{title}</div>
          {subtitle ? <div className="small text-muted">{subtitle}</div> : null}
        </div>
        {actions}
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}
