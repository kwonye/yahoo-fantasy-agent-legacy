import type { GetServerSideProps } from 'next';
import type { QuotaSnapshot } from '../src/lib/quota';
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { isAuthorized } from '../src/lib/auth';

type AppPageProps = {
  initialQuota: QuotaSnapshot | null;
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

  const { getQuotaSnapshot } = await import('../src/lib/quota');

  return {
    props: {
      initialQuota: getQuotaSnapshot(),
    },
  };
};

type AnyObj = Record<string, any>;

type BadgeConfig = {
  label: string;
  value: ReactNode;
};

function fetchJson(url: string, opts?: RequestInit) {
  const init: RequestInit = { credentials: 'include', ...opts };
  const headers = new Headers(init.headers || {});
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  init.headers = headers;

  return fetch(url, init).then(async response => {
    const text = await response.text().catch(() => '');
    try {
      return JSON.parse(text);
    } catch {
      return text || {};
    }
  });
}

function jsonHighlightHtml(obj: unknown) {
  try {
    const json = JSON.stringify(obj ?? {}, null, 2);
    const escape = (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let safe = escape(json);
    safe = safe.replace(
      /(\"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\\"])*\"\s*:)|(\"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\\"])*\")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      (match, groupKey, groupString, groupBoolNull, groupNumber) => {
        if (groupKey) return `<span class="json-key">${groupKey}</span>`;
        if (groupString) return `<span class="json-string">${groupString}</span>`;
        if (groupBoolNull) {
          if (groupBoolNull === 'true' || groupBoolNull === 'false') {
            return `<span class="json-boolean">${groupBoolNull}</span>`;
          }
          return `<span class="json-null">${groupBoolNull}</span>`;
        }
        if (groupNumber) return `<span class="json-number">${groupNumber}</span>`;
        return match;
      }
    );
    return safe;
  } catch (error) {
    return String(error);
  }
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDateTime(value: unknown) {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}

const EMPTY_ARRAY: any[] = [];

export default function AppPage({ initialQuota }: AppPageProps): JSX.Element {
  const [health, setHealth] = useState<AnyObj | string>('Loading…');
  const [metrics, setMetrics] = useState<AnyObj>({});
  const [creds, setCreds] = useState<AnyObj>({});
  const [activity, setActivity] = useState<any[]>(EMPTY_ARRAY);
  const [geminiLogs, setGeminiLogs] = useState<any[]>(EMPTY_ARRAY);
  const [roster, setRoster] = useState<any[]>(EMPTY_ARRAY);
  const [leagueProfile, setLeagueProfile] = useState<AnyObj | null>(null);
  const [trades, setTrades] = useState<any[]>(EMPTY_ARRAY);
  const [quota, setQuota] = useState<AnyObj | null>(initialQuota);
  const [env, setEnv] = useState<AnyObj>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const [yClientId, setYClientId] = useState('');
  const [yClientSecret, setYClientSecret] = useState('');
  const [gApiKey, setGApiKey] = useState('');
  const [gModel, setGModel] = useState('gemini-2.5-pro');
  const [leagueKeyInput, setLeagueKeyInput] = useState('');
  const [teamKeyInput, setTeamKeyInput] = useState('');
  const [redirectUriInput, setRedirectUriInput] = useState('');

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [healthResp, credsResp, metricsResp, activityResp, geminiResp, envResp, quotaResp] = await Promise.all([
        fetchJson('/api/health'),
        fetchJson('/api/creds'),
        fetchJson('/api/metrics'),
        fetchJson('/api/activity'),
        fetchJson('/api/gemini/logs'),
        fetchJson('/api/env'),
        fetchJson('/api/quota').catch(() => null),
      ]);

      setHealth(healthResp);
      setCreds(typeof credsResp === 'object' && credsResp !== null ? (credsResp as AnyObj) : {});
      setMetrics(metricsResp && typeof metricsResp === 'object' && 'metrics' in (metricsResp as AnyObj)
        ? ((metricsResp as AnyObj).metrics as AnyObj)
        : {});
      setActivity(Array.isArray(activityResp?.events) ? activityResp.events : EMPTY_ARRAY);
      setGeminiLogs(Array.isArray(geminiResp?.logs) ? geminiResp.logs : EMPTY_ARRAY);
      setEnv(typeof envResp === 'object' && envResp !== null ? (envResp as AnyObj) : {});

      setQuota(prev => {
        if (quotaResp && typeof quotaResp === 'object' && 'ok' in quotaResp && (quotaResp as AnyObj).ok) {
          return quotaResp;
        }
        return prev ?? initialQuota ?? null;
      });

      try {
        const rawYahoo = await fetchJson('/api/creds/yahoo/raw');
        if (rawYahoo && rawYahoo.ok) {
          setYClientId(rawYahoo.clientId || '');
          setYClientSecret(rawYahoo.clientSecret || '');
        }
      } catch {}

      try {
        const rawGemini = await fetchJson('/api/creds/gemini/raw');
        if (rawGemini && rawGemini.ok) {
          setGApiKey(rawGemini.apiKey || '');
          setGModel(rawGemini.model || 'gemini-2.5-pro');
        }
      } catch {}

      try {
        const rosterResp = await fetchJson('/api/roster');
        setRoster(rosterResp?.roster || EMPTY_ARRAY);
      } catch {}

      try {
        const profileResp = await fetchJson('/api/league-config');
        setLeagueProfile(profileResp?.profile || null);
      } catch {}

      try {
        const tradesResp = await fetchJson('/api/trades/incoming?debug=1');
        setTrades(tradesResp?.trades || EMPTY_ARRAY);
      } catch {}

      setLastUpdated(new Date().toISOString());
    } catch (error) {
      console.error('refresh failed', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [initialQuota]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function saveYahooCreds(event?: FormEvent) {
    event?.preventDefault();
    const response = await fetch('/api/creds/yahoo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: yClientId, clientSecret: yClientSecret }),
    });
    const result = await response.json().catch(() => ({ ok: false }));
    alert(result.ok ? 'Yahoo credentials saved' : `Save failed: ${result.error || 'unknown'}`);
    refresh();
  }

  async function saveGemini(event?: FormEvent) {
    event?.preventDefault();
    const response = await fetch('/api/creds/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: gApiKey, model: gModel }),
    });
    const result = await response.json().catch(() => ({ ok: false }));
    alert(result.ok ? 'Gemini settings saved' : `Save failed: ${result.error || 'unknown'}`);
    refresh();
  }

  async function saveEnv() {
    const leagueKey = leagueKeyInput;
    const teamKey = teamKeyInput;
    const redirectUri = redirectUriInput;
    const response = await fetch('/api/env', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueKey, teamKey, redirectUri }),
    });
    const result = await response.json().catch(() => ({ ok: false }));
    alert(result.ok ? 'Keys saved' : `Save failed: ${result.error || 'unknown'}`);
    localStorage.setItem('leagueKey', leagueKey);
    localStorage.setItem('teamKey', teamKey);
    refresh();
  }

  async function runBot(event?: FormEvent) {
    event?.preventDefault();
    const response = await fetch('/api/bot/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueKey: leagueKeyInput || env.leagueKey, teamKey: teamKeyInput || env.teamKey }),
    });
    const result = await response.json().catch(() => ({ ok: false }));
    alert(result.ok ? 'Bot run triggered' : `Run failed: ${result.error || 'unknown'}`);
    refresh();
  }

  const badges: BadgeConfig[] = useMemo(
    () => [
      { label: 'Mode', value: env?.applyChanges ? 'Live Writes' : 'Dry Run' },
      { label: 'Yahoo', value: creds?.creds?.yahoo ? 'Connected' : 'Missing' },
      { label: 'Gemini', value: creds?.creds?.gemini ? 'Connected' : 'Missing' },
      {
        label: 'Quota',
        value: quota ? `${quota.remaining ?? '—'} / ${quota.limit ?? '—'}` : '—',
      },
    ],
    [creds, env, quota]
  );

  const activityRows = useMemo(() => activity.slice().reverse(), [activity]);
  const geminiEntries = useMemo(() => geminiLogs.slice().reverse(), [geminiLogs]);

  return (
    <div className="dashboard">
      <header className="dashboard__header">
        <div className="dashboard__title">Fantasy Football Bot</div>
        <div className="dashboard__toolbar">
          <button
            className="btn btn-secondary"
            onClick={refresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <div className="dashboard__badges">
            {badges.map(badge => (
              <div key={badge.label} className="badge">
                <span className="badge__label">{badge.label}</span>
                <span className="badge__value">{badge.value}</span>
              </div>
            ))}
          </div>
        </div>
      </header>

      <div className="dashboard__body">
        <aside className="dashboard__sidebar">
          <Card title="System Health">
            <JsonPreview value={health} emptyLabel="No status reported yet." />
          </Card>

          <Card title="Metrics">
            <JsonPreview value={metrics} emptyLabel="No metrics available." />
          </Card>

          <Card title="Gemini Quota">
            <JsonPreview
              value={quota ? {
                limit: quota.limit,
                used: quota.used,
                remaining: quota.remaining,
                resetsAt: quota.resetsAt,
              } : {}}
              emptyLabel="Quota data unavailable."
            />
          </Card>

          <Card title="Credentials">
            <JsonPreview
              value={{
                yahoo: creds?.creds?.yahoo || null,
                gemini: creds?.creds?.gemini || null,
              }}
              emptyLabel="No credentials stored."
            />
            <form onSubmit={saveYahooCreds} className="form">
              <Field label="Yahoo Client ID">
                <input value={yClientId} onChange={event => setYClientId(event.target.value)} />
              </Field>
              <Field label="Yahoo Client Secret">
                <input value={yClientSecret} onChange={event => setYClientSecret(event.target.value)} />
              </Field>
              <div className="form__actions">
                <button type="submit" className="btn btn-primary btn-sm">Save Yahoo Creds</button>
                <a className="btn btn-outline btn-sm" href="/auth/yahoo/start">Connect Yahoo</a>
              </div>
            </form>
            <form onSubmit={saveGemini} className="form">
              <Field label="Gemini API Key">
                <input value={gApiKey} onChange={event => setGApiKey(event.target.value)} />
              </Field>
              <Field label="Gemini Model">
                <input value={gModel} onChange={event => setGModel(event.target.value)} />
              </Field>
              <div className="form__actions">
                <button type="submit" className="btn btn-primary btn-sm">Save Gemini Settings</button>
              </div>
            </form>
          </Card>

          <Card title="League Setup">
            <form onSubmit={event => { event.preventDefault(); runBot(); }} className="form">
              <Field label="League Key">
                <input
                  value={leagueKeyInput}
                  onChange={event => setLeagueKeyInput(event.target.value)}
                  placeholder="nfl.l.123456"
                />
              </Field>
              <Field label="Team Key">
                <input
                  value={teamKeyInput}
                  onChange={event => setTeamKeyInput(event.target.value)}
                  placeholder="team key or number"
                />
              </Field>
              <Field label="Redirect URI">
                <input
                  value={redirectUriInput}
                  onChange={event => setRedirectUriInput(event.target.value)}
                  placeholder="https://example.com/callback"
                />
              </Field>
              <div className="form__actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={saveEnv}>Save Keys</button>
                <button type="submit" className="btn btn-outline btn-sm">Run Bot Now</button>
              </div>
            </form>
          </Card>
        </aside>

        <section className="dashboard__content">
          <Card
            title="Recent Activity"
            subtitle={lastUpdated ? `Last updated ${formatDateTime(lastUpdated)}` : undefined}
            actions={
              <div className="card__actions">
                <button className="btn btn-outline btn-sm" onClick={refresh} disabled={isRefreshing}>
                  Refresh
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={async () => {
                    await fetch('/api/logs/clear', { method: 'POST' });
                    refresh();
                  }}
                >
                  Clear Logs
                </button>
              </div>
            }
          >
            {activityRows.length === 0 ? (
              <EmptyState message="No activity yet." />
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Type</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityRows.map((event, index) => (
                      <tr key={index}>
                        <td>{formatDateTime(event.ts || event.time)}</td>
                        <td>{event.type || 'log'}</td>
                        <td>
                          <code>{JSON.stringify(event.decision || event.error || event.meta || event)}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Gemini Activity">
            {geminiEntries.length === 0 ? (
              <EmptyState message="No logged Gemini conversations yet." />
            ) : (
              <div className="timeline">
                {geminiEntries.map((item: any, index: number) => (
                  <article key={index} className="timeline__item">
                    <div className="timeline__timestamp">{formatDateTime(item.ts)}</div>
                    <dl>
                      <dt>system</dt>
                      <dd>{String(item.system || '')}</dd>
                      <dt>user</dt>
                      <dd>{String(item.user || '')}</dd>
                      <dt>assistant</dt>
                      <dd>{String(item.response || '')}</dd>
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </Card>

          <Card title="Ask Gemini">
            <GeminiTester onDone={refresh} />
          </Card>

          <Card title="Current Roster">
            {roster.length === 0 ? (
              <EmptyState message="Roster not loaded." />
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Slot</th>
                      <th>Pos</th>
                      <th>Player</th>
                      <th>Team</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((entry, index) => (
                      <tr key={index}>
                        <td>{entry.slot || '—'}</td>
                        <td>{entry.player?.position || ''}</td>
                        <td>{entry.player?.name || ''}</td>
                        <td>{entry.player?.team || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="League Profile">
            <JsonPreview value={leagueProfile || {}} emptyLabel="League profile not loaded." />
          </Card>

          <Card title="Incoming Trades">
            {trades.length === 0 ? (
              <EmptyState message="No incoming trades at the moment." />
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((trade: any, index: number) => (
                      <tr key={index}>
                        <td>{trade.id}</td>
                        <td>{trade.status}</td>
                        <td className="table-actions">
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => alert(JSON.stringify(trade, null, 2))}
                          >
                            View
                          </button>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={async () => {
                              const response = await fetch('/api/trades/evaluate', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  leagueKey: leagueKeyInput || env.leagueKey,
                                  teamKey: teamKeyInput || env.teamKey,
                                  tradeId: trade.id,
                                }),
                              });
                              const result = await response.json();
                              alert(
                                result.ok
                                  ? `Gemini suggests: ${result.decision?.shouldAccept ? 'ACCEPT' : 'DECLINE'}`
                                  : `Error: ${result.error}`
                              );
                            }}
                          >
                            Evaluate
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>
      </div>

      <style jsx global>{`
        :root {
          color-scheme: dark;
          --bg: #0f172a;
          --bg-panel: #111c33;
          --bg-panel-alt: #12213f;
          --border: rgba(148, 163, 184, 0.2);
          --text: #f1f5f9;
          --text-muted: #94a3b8;
          --primary: #7c3aed;
          --primary-dark: #5b21b6;
          --danger: #ef4444;
          --success: #22c55e;
          font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }

        body {
          margin: 0;
          background: linear-gradient(135deg, rgba(15, 23, 42, 1) 0%, rgba(15, 23, 42, 0.85) 55%, rgba(45, 36, 73, 0.9) 100%);
          color: var(--text);
          min-height: 100vh;
        }

        a {
          color: var(--primary);
        }

        .dashboard {
          min-height: 100vh;
          padding: 24px;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .dashboard__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
        }

        .dashboard__title {
          font-size: 1.75rem;
          font-weight: 700;
        }

        .dashboard__toolbar {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }

        .dashboard__badges {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .badge {
          background: var(--bg-panel);
          border: 1px solid var(--border);
          padding: 8px 12px;
          border-radius: 999px;
          display: flex;
          gap: 6px;
          align-items: center;
          font-size: 0.85rem;
        }

        .badge__label {
          color: var(--text-muted);
        }

        .badge__value {
          font-weight: 600;
        }

        .dashboard__body {
          display: grid;
          grid-template-columns: minmax(280px, 360px) 1fr;
          gap: 24px;
          align-items: flex-start;
        }

        @media (max-width: 1080px) {
          .dashboard__body {
            grid-template-columns: 1fr;
          }
        }

        .dashboard__sidebar,
        .dashboard__content {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .card {
          background: radial-gradient(circle at top left, rgba(124, 58, 237, 0.12), transparent 70%), var(--bg-panel);
          border: 1px solid var(--border);
          border-radius: 18px;
          padding: 20px;
          box-shadow: 0 18px 34px rgba(15, 23, 42, 0.45);
        }

        .card__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          margin-bottom: 16px;
        }

        .card__title {
          font-size: 1.1rem;
          font-weight: 600;
        }

        .card__subtitle {
          color: var(--text-muted);
          font-size: 0.9rem;
          margin-top: 4px;
        }

        .card__actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .card__body {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .json-block {
          background: var(--bg-panel-alt);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 12px;
          max-height: 280px;
          overflow: auto;
        }

        .json-block pre {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
          font-family: 'SFMono-Regular', ui-monospace, Menlo, Monaco, 'Cascadia Mono', 'Segoe UI Mono', monospace;
          font-size: 0.85rem;
          line-height: 1.4;
        }

        .json-block--empty {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 80px;
          color: var(--text-muted);
          text-align: center;
          font-size: 0.9rem;
          padding: 12px 16px;
        }

        .json-key { color: #a78bfa; }
        .json-string { color: #f0abfc; }
        .json-number { color: #facc15; }
        .json-boolean { color: #34d399; }
        .json-null { color: var(--text-muted); }

        .btn {
          border: none;
          border-radius: 999px;
          padding: 10px 16px;
          font-weight: 600;
          font-size: 0.9rem;
          cursor: pointer;
          background: rgba(255, 255, 255, 0.05);
          color: var(--text);
          transition: transform 120ms ease, background 120ms ease, box-shadow 120ms ease;
        }

        .btn:hover:not(:disabled) {
          transform: translateY(-1px);
          background: rgba(255, 255, 255, 0.12);
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.3);
        }

        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .btn-sm {
          padding: 6px 12px;
          font-size: 0.82rem;
        }

        .btn-primary {
          background: var(--primary);
        }

        .btn-primary:hover:not(:disabled) {
          background: var(--primary-dark);
        }

        .btn-secondary {
          background: rgba(148, 163, 184, 0.15);
        }

        .btn-outline {
          background: transparent;
          border: 1px solid rgba(148, 163, 184, 0.4);
        }

        .btn-outline:hover:not(:disabled) {
          border-color: rgba(148, 163, 184, 0.8);
        }

        .btn-danger {
          background: var(--danger);
        }

        .btn-danger:hover:not(:disabled) {
          background: #dc2626;
        }

        .form {
          display: flex;
          flex-direction: column;
          gap: 16px;
          margin-top: 12px;
        }

        .form__field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin: 0;
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-muted);
        }

        .form__field span {
          margin: 0;
        }

        .form input,
        .form textarea {
          width: 100%;
          border-radius: 10px;
          padding: 0.85rem 1rem;
          border: 1px solid rgba(148, 163, 184, 0.32);
          background: rgba(15, 23, 42, 0.45);
          color: var(--text);
          font-size: 0.95rem;
          font-family: inherit;
          line-height: 1.4;
          box-sizing: border-box;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .form input:focus,
        .form textarea:focus {
          outline: none;
          border-color: rgba(124, 58, 237, 0.7);
          box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.25);
        }

        .form__actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .table-wrapper {
          border-radius: 12px;
          border: 1px solid var(--border);
          overflow: hidden;
          background: var(--bg-panel-alt);
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.88rem;
        }

        thead {
          background: rgba(124, 58, 237, 0.18);
        }

        th,
        td {
          padding: 10px 12px;
          text-align: left;
          border-bottom: 1px solid rgba(15, 23, 42, 0.35);
        }

        tbody tr:nth-child(even) {
          background: rgba(255, 255, 255, 0.03);
        }

        tbody tr:hover {
          background: rgba(124, 58, 237, 0.12);
        }

        code {
          font-family: 'SFMono-Regular', ui-monospace, Menlo, Monaco, 'Cascadia Mono', 'Segoe UI Mono', monospace;
          white-space: pre-wrap;
        }

        .timeline {
          display: flex;
          flex-direction: column;
          gap: 16px;
          max-height: 320px;
          overflow-y: auto;
          padding-right: 8px;
        }

        .timeline__item {
          border-left: 2px solid rgba(124, 58, 237, 0.4);
          padding-left: 12px;
        }

        .timeline__timestamp {
          font-size: 0.75rem;
          color: var(--text-muted);
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .timeline dl {
          margin: 0;
          display: grid;
          grid-template-columns: 80px 1fr;
          gap: 6px 12px;
          font-size: 0.88rem;
        }

        .timeline dt {
          color: var(--text-muted);
          text-transform: uppercase;
          font-weight: 600;
          letter-spacing: 0.05em;
        }

        .timeline dd {
          margin: 0;
          line-height: 1.4;
        }

        .table-actions {
          display: flex;
          gap: 8px;
        }

        .empty-state {
          padding: 36px;
          text-align: center;
          color: var(--text-muted);
          background: rgba(255, 255, 255, 0.02);
          border-radius: 12px;
          border: 1px dashed rgba(148, 163, 184, 0.25);
        }

        .empty-state strong {
          display: block;
          font-size: 1rem;
          color: var(--text);
        }
      `}</style>
    </div>
  );
}

function Card({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode; }) {
  return (
    <section className="card">
      <div className="card__header">
        <div>
          <div className="card__title">{title}</div>
          {subtitle ? <div className="card__subtitle">{subtitle}</div> : null}
        </div>
        {actions}
      </div>
      <div className="card__body">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="form__field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="empty-state">
      <strong>{message}</strong>
      <span>Check back after the bot has run.</span>
    </div>
  );
}

function normalizeJsonValue(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return {};
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  if (value === null || value === undefined) return {};
  return value;
}

function JsonPreview({ value, emptyLabel }: { value: unknown; emptyLabel?: string }) {
  const normalized = normalizeJsonValue(value);

  if (typeof normalized === 'string') {
    const display = normalized.trim() || emptyLabel || '—';
    return (
      <div className="json-block">
        <pre>{display}</pre>
      </div>
    );
  }

  if (typeof normalized === 'number' || typeof normalized === 'boolean') {
    return (
      <div className="json-block">
        <pre>{String(normalized)}</pre>
      </div>
    );
  }

  const isEmptyObject = normalized && !Array.isArray(normalized) && typeof normalized === 'object'
    ? Object.keys(normalized as Record<string, unknown>).length === 0
    : false;
  const isEmptyArray = Array.isArray(normalized) && normalized.length === 0;

  if ((isEmptyObject || isEmptyArray) && emptyLabel) {
    return (
      <div className="json-block json-block--empty">
        <span>{emptyLabel}</span>
      </div>
    );
  }

  return (
    <div className="json-block">
      <pre dangerouslySetInnerHTML={{ __html: jsonHighlightHtml(normalized) }} />
    </div>
  );
}

function GeminiTester({ onDone }: { onDone?: () => void }) {
  const [prompt, setPrompt] = useState('Say hello.');
  const [result, setResult] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function send() {
    if (!prompt.trim()) return;
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/gemini/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const json = await response.json().catch(() => ({ ok: false }));
      setResult(json.ok ? String(json.response) : `Error: ${json.error || 'unknown'}`);
      onDone?.();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="form">
      <Field label="Prompt">
        <textarea
          rows={3}
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          placeholder="Ask a quick question or describe a trade scenario"
        />
      </Field>
      <div className="form__actions">
        <button type="button" className="btn btn-primary" onClick={send} disabled={isSubmitting}>
          {isSubmitting ? 'Sending…' : 'Send To Gemini'}
        </button>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => setPrompt('')}
          disabled={isSubmitting || prompt.length === 0}
        >
          Clear
        </button>
      </div>
      {result ? (
        <div className="json-block" style={{ maxHeight: 180 }}>
          <pre><code>{result}</code></pre>
        </div>
      ) : null}
    </div>
  );
}
