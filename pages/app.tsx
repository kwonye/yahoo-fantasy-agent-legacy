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
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-pro');
  const [leagueKeyInput, setLeagueKeyInput] = useState('');
  const [teamKeyInput, setTeamKeyInput] = useState('');
  const [redirectUriInput, setRedirectUriInput] = useState('');
  const [theirTeamNumber, setTheirTeamNumber] = useState('');

  const [yahooClientTouched, setYahooClientTouched] = useState(false);
  const [yahooSecretTouched, setYahooSecretTouched] = useState(false);
  const [geminiKeyTouched, setGeminiKeyTouched] = useState(false);
  const [geminiModelTouched, setGeminiModelTouched] = useState(false);
  const [leagueKeyTouched, setLeagueKeyTouched] = useState(false);
  const [teamKeyTouched, setTeamKeyTouched] = useState(false);
  const [redirectTouched, setRedirectTouched] = useState(false);

  const [prompt, setPrompt] = useState('');
  const [promptResult, setPromptResult] = useState('');
  const [previewType, setPreviewType] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState('');

  const [isSavingFeatures, setIsSavingFeatures] = useState(false);
  const [isSendingPrompt, setIsSendingPrompt] = useState(false);

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
        if (!geminiModelTouched) setGeminiModel(map.geminiRaw.model || 'gemini-2.5-pro');
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
  }, [geminiKeyTouched, geminiModelTouched, leagueKeyTouched, teamKeyTouched, yahooClientTouched, yahooSecretTouched]);

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
    const body = { apiKey: geminiApiKey, model: geminiModel };
    const result = await fetchJson('/api/creds/gemini', { method: 'POST', body: JSON.stringify(body) });
    if ((result as any)?.ok) {
      alert('Gemini settings saved');
      setGeminiKeyTouched(false);
      setGeminiModelTouched(false);
      refreshAll();
    } else {
      alert(`Save failed: ${(result as any)?.error || 'unknown'}`);
    }
  }, [geminiApiKey, geminiModel, refreshAll]);

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
    const leagueKey = leagueTeamDisplay.league;
    const teamKey = leagueTeamDisplay.team;
    if (!leagueKey || !teamKey) {
      alert('Set league and team keys first');
      return;
    }
    const result = await fetchJson(endpoint, { method: 'POST', body: JSON.stringify({ leagueKey, teamKey }) }).catch(() => ({ ok: false }));
    if ((result as any)?.ok) {
      alert(`${label} completed`);
      refreshAll();
    } else {
      alert(`${label} failed: ${(result as any)?.error || 'unknown'}`);
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
                      <div className="mb-3">
                        <label className="form-label">Gemini Model</label>
                        <input value={geminiModel} onChange={(e) => { setGeminiModel(e.target.value); setGeminiModelTouched(true); }} className="form-control form-control-sm" />
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
                      <button className="btn btn-sm btn-outline-secondary" onClick={refreshAll} disabled={isRefreshing}>{isRefreshing ? 'Refreshing…' : 'Refresh'}</button>
                      <button className="btn btn-sm btn-outline-danger" onClick={handleClearActivity}>Clear Activity</button>
                    </div>
                  }>
                    <div className="table-responsive" style={{ maxHeight: 320 }}>
                      <table className="table table-sm table-striped mono">
                        <thead><tr><th>Time</th><th>Type</th><th>Details</th></tr></thead>
                        <tbody>
                          {activity.length === 0 ? (
                            <tr><td colSpan={3} className="text-center text-muted">No activity yet.</td></tr>
                          ) : activity.map((event, idx) => (
                            <tr key={idx}>
                              <td>{formatDateTime(event.ts || event.time)}</td>
                              <td>{event.type || 'log'}</td>
                              <td><code>{JSON.stringify(event.decision || event.action || event.error || event.details || event.meta || event)}</code></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </DashboardCard>
                </div>

                <div className="col-12">
                  <DashboardCard title="Gemini Activity" actions={
                    <div className="d-flex gap-2">
                      <button className="btn btn-sm btn-outline-secondary" onClick={refreshAll}>Refresh</button>
                      <button className="btn btn-sm btn-outline-danger" onClick={handleClearGemini}>Clear</button>
                    </div>
                  }>
                    <div className="gemini-log">
                      {geminiLogs.length === 0 ? (
                        <div className="text-muted">No logged Gemini conversations yet.</div>
                      ) : geminiLogs.map((item, idx) => (
                        <div className="mb-3" key={idx}>
                          <div className="text-muted small">{formatDateTime(item.ts)}</div>
                          <div><strong>system</strong>: {item.system}</div>
                          <div><strong>user</strong>: {item.user}</div>
                          <div><strong>assistant</strong>: {item.response}</div>
                        </div>
                      ))}
                    </div>
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
        .gemini-log { max-height: 260px; overflow: auto; }
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
