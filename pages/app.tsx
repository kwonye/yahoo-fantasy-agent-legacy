import React, { useEffect, useState, FormEvent } from 'react';

type AnyObj = Record<string, any>;

function fetchJson(url: string, opts?: RequestInit) {
  return fetch(url, opts).then(async (r) => {
    const txt = await r.text().catch(() => '');
    try { return JSON.parse(txt); } catch { return txt || {}; }
  });
}

function jsonHighlightHtml(obj: any) {
  try {
    const json = JSON.stringify(obj ?? {}, null, 2);
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let s = esc(json);
    s = s.replace(/(\"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\\"])*\"\s*:)|(\"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\\"])*\")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      (m: string, gKey: string, gStr: string, gBoolNull: string, gNum: string) => {
        if (gKey) return '<span class="key">' + gKey + '</span>';
        if (gStr) return '<span class="string">' + gStr + '</span>';
        if (gBoolNull) {
          if (gBoolNull === 'true' || gBoolNull === 'false') return '<span class="boolean">' + gBoolNull + '</span>';
          return '<span class="null">' + gBoolNull + '</span>';
        }
        if (gNum) return '<span class="number">' + gNum + '</span>';
        return m;
      });
    return s;
  } catch (e) {
    return String(obj);
  }
}

export default function AppPage(): JSX.Element {
  const [health, setHealth] = useState<any>('Loading...');
  const [metrics, setMetrics] = useState<any>({});
  const [creds, setCreds] = useState<any>({});
  const [activity, setActivity] = useState<any[]>([]);
  const [geminiLogs, setGeminiLogs] = useState<any[]>([]);
  const [roster, setRoster] = useState<any[]>([]);
  const [leagueProfile, setLeagueProfile] = useState<any | null>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [quota, setQuota] = useState<any>(null);
  const [env, setEnv] = useState<any>({});

  // form fields
  const [yClientId, setYClientId] = useState('');
  const [yClientSecret, setYClientSecret] = useState('');
  const [gApiKey, setGApiKey] = useState('');
  const [gModel, setGModel] = useState('gemini-2.5-pro');
  const [leagueKeyInput, setLeagueKeyInput] = useState('');
  const [teamKeyInput, setTeamKeyInput] = useState('');
  const [redirectUriInput, setRedirectUriInput] = useState('');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    try {
      const h = await fetchJson('/health'); setHealth(h);
      const c = await fetchJson('/api/creds'); setCreds(c);
      const m = await fetchJson('/api/metrics'); setMetrics(m?.metrics || {});
      const a = await fetchJson('/api/activity'); setActivity(a?.events || []);
      const g = await fetchJson('/api/gemini/logs'); setGeminiLogs(g?.logs || []);
      const e = await fetchJson('/api/env'); setEnv(e || {});
      const q = await fetchJson('/api/quota').catch(()=>null); setQuota(q && q.ok ? q : null);
      // fill form fields from env/creds raw endpoints (attempt)
      try { const rawY = await fetchJson('/api/creds/yahoo/raw'); if (rawY && rawY.ok) { setYClientId(rawY.clientId||''); setYClientSecret(rawY.clientSecret||''); } } catch {}
      try { const rawG = await fetchJson('/api/creds/gemini/raw'); if (rawG && rawG.ok) { setGApiKey(rawG.apiKey||''); setGModel(rawG.model||gModel); } } catch {}
      // roster & league & trades
      try { const r = await fetchJson('/api/roster'); setRoster(r?.roster || []); } catch {}
      try { const lp = await fetchJson('/api/league-config'); setLeagueProfile(lp?.profile || null); } catch {}
      try { const tr = await fetchJson('/api/trades/incoming?debug=1'); setTrades(tr?.trades || []); } catch {}
    } catch (e) { console.error('refresh failed', e); }
  }

  async function saveYahooCreds(e?: FormEvent) {
    e?.preventDefault();
    const r = await fetch('/api/creds/yahoo', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ clientId: yClientId, clientSecret: yClientSecret }) });
    const j = await r.json().catch(()=>({ok:false}));
    alert(j.ok ? 'Yahoo creds saved' : ('Save failed: ' + (j.error||'unknown')));
    refresh();
  }

  async function saveGemini(e?: FormEvent) {
    e?.preventDefault();
    const r = await fetch('/api/creds/gemini', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ apiKey: gApiKey, model: gModel }) });
    const j = await r.json().catch(()=>({ok:false}));
    alert(j.ok ? 'Gemini key saved' : ('Save failed: ' + (j.error||'unknown')));
    refresh();
  }

  async function saveEnv() {
    const leagueKey = leagueKeyInput; const teamKey = teamKeyInput; const redirectUri = redirectUriInput;
    const r = await fetch('/api/env', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ leagueKey, teamKey, redirectUri }) });
    const j = await r.json().catch(()=>({ok:false}));
    alert(j.ok ? 'Keys saved' : ('Save failed: ' + (j.error||'unknown')));
    localStorage.setItem('leagueKey', leagueKey); localStorage.setItem('teamKey', teamKey);
    refresh();
  }

  async function runBot(e?: FormEvent) {
    e?.preventDefault();
    const leagueKey = leagueKeyInput; const teamKey = teamKeyInput;
    const r = await fetch('/api/bot/run', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ leagueKey, teamKey }) });
    const j = await r.json().catch(()=>({ok:false}));
    alert(j.ok ? 'Bot run complete' : ('Run failed: ' + (j.error||'unknown')));
    refresh();
  }

  return (
    <div>
      <style jsx global>{`
      :root {
        --bg: #fff7fb;
        --bg-2: #f7f1ff;
        --fg: #2b2233;
        --card: #ffffff;
        --border: #f0e6f6;
        --muted: #8b6f9e;
        --accent-pink: #ff7ab8;
        --accent-pink-2: #ffc2dd;
        --accent-purple: #a78bfa;
        --accent-purple-2: #dec9ff;
        --danger: #ff8da1;
      }
      body { margin: 0; padding: 16px; background: radial-gradient(1200px 600px at 20% -10%, var(--bg) 0%, var(--bg) 60%), radial-gradient(1000px 500px at 110% 10%, var(--bg-2) 0%, var(--bg-2) 50%), linear-gradient(180deg, var(--bg), var(--bg-2)); color:var(--fg); font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 13px; }
      .navbar { background: linear-gradient(180deg, var(--bg-2), var(--bg)); padding: 8px 16px; border-bottom: 1px solid var(--border); border-radius: 8px; }
      .card { background: var(--card); border: 1px solid var(--border); box-shadow: 0 6px 18px rgba(167,139,250,0.08); border-radius: 14px; padding: 12px; }
      .card-header { background: linear-gradient(180deg, #faf5ff, #fff0f7); border-bottom: 1px solid var(--border); font-weight: 600; font-size: 14px; padding: 8px 12px; border-top-left-radius: 10px; border-top-right-radius: 10px; }
      .json-pre { background: #fff7fb; border: 1px solid var(--border); border-radius: 10px; padding: 10px; overflow: auto; }
      .json-pre .key { color: var(--accent-purple); }
      .json-pre .string { color: #d069a1; }
      .json-pre .number { color: #c257d3; }
      .json-pre .boolean { color: #a163df; }
      .json-pre .null { color: var(--muted); }
      .json-pre .punct { color: #b99bd8; }
      .badge { padding: 6px 8px; border-radius: 8px; }
      `}</style>

      <header className="navbar d-flex justify-content-between align-items-center">
        <div style={{ fontWeight: 600, color: 'var(--accent-purple)' }}>Fantasy Football Bot</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="badge bg-secondary">Mode: { (env?.applyChanges) ? 'Live Writes' : 'Dry Run' }</div>
          <div className="badge bg-secondary">Yahoo: { creds?.creds?.yahoo ? 'OK' : 'Missing' }</div>
          <div className="badge bg-secondary">Gemini: { creds?.creds?.gemini ? 'OK' : 'Missing' }</div>
          <div className="badge bg-secondary">Quota: { quota ? `${quota.remaining}/${quota.limit}` : '…' }</div>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '18px auto' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: '0 0 360px' }}>
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-header">Health</div>
              <div className="mono" style={{ padding: 8 }}>{ typeof health === 'string' ? health : <pre className="json-pre" dangerouslySetInnerHTML={{ __html: jsonHighlightHtml(health) }} /> }</div>
            </div>
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-header">Metrics</div>
              <div style={{ padding: 8 }} dangerouslySetInnerHTML={{ __html: jsonHighlightHtml(metrics) }} />
            </div>

            <div className="card">
              <div className="card-header">Credentials</div>
              <div style={{ paddingTop: 8 }}>
                <div className="mono" style={{ marginBottom: 8 }} dangerouslySetInnerHTML={{ __html: jsonHighlightHtml({ yahoo: creds?.creds?.yahoo || null, gemini: creds?.creds?.gemini || null }) }} />
                <form onSubmit={saveYahooCreds} className="mono" style={{ marginBottom: 8 }}>
                  <label className="form-label">Yahoo Client ID</label>
                  <input value={yClientId} onChange={(e)=>setYClientId(e.target.value)} className="form-control" />
                  <label className="form-label" style={{ marginTop: 8 }}>Yahoo Client Secret</label>
                  <input value={yClientSecret} onChange={(e)=>setYClientSecret(e.target.value)} className="form-control" />
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button className="btn btn-sm btn-secondary" type="submit">Save Yahoo Creds</button>
                    <a className="btn btn-sm btn-outline-primary" href="/auth/yahoo/start">Connect Yahoo</a>
                  </div>
                </form>
                <form onSubmit={saveGemini} className="mono">
                  <label className="form-label">Gemini API Key</label>
                  <input value={gApiKey} onChange={(e)=>setGApiKey(e.target.value)} className="form-control" />
                  <label className="form-label" style={{ marginTop: 8 }}>Gemini Model</label>
                  <input value={gModel} onChange={(e)=>setGModel(e.target.value)} className="form-control" />
                  <div style={{ marginTop: 8 }}><button className="btn btn-sm btn-secondary" type="submit">Save Gemini Settings</button></div>
                </form>
                <hr />
                <form onSubmit={(e)=>{ e.preventDefault(); runBot(); }} className="mono">
                  <label className="form-label">League</label>
                  <input value={leagueKeyInput} onChange={(e)=>setLeagueKeyInput(e.target.value)} className="form-control" placeholder="nfl.l.1548559 or digits" />
                  <label className="form-label" style={{ marginTop: 8 }}>Team</label>
                  <input value={teamKeyInput} onChange={(e)=>setTeamKeyInput(e.target.value)} className="form-control" placeholder="team number or full team key" />
                  <label className="form-label" style={{ marginTop: 8 }}>Redirect URI</label>
                  <input value={redirectUriInput} onChange={(e)=>setRedirectUriInput(e.target.value)} className="form-control" />
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={saveEnv}>Save Keys</button>
                    <button type="submit" className="btn btn-sm btn-outline-primary">Run Bot Now</button>
                  </div>
                </form>
              </div>
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Recent Activity</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm btn-outline-secondary" onClick={refresh}>Refresh</button>
                  <button className="btn btn-sm btn-outline-danger" onClick={async ()=>{ await fetch('/api/logs/clear', { method: 'POST' }); refresh(); }}>Clear Activity</button>
                </div>
              </div>
              <div style={{ padding: 8 }}>
                <div style={{ maxHeight: 260, overflow: 'auto' }}>
                  <table className="table table-sm table-striped mono">
                    <thead><tr><th>Time</th><th>Type</th><th>Details</th></tr></thead>
                    <tbody>
                      {activity.slice().reverse().map((ev, i) => (
                        <tr key={i}><td>{new Date(ev.ts||ev.time||Date.now()).toLocaleString()}</td><td>{ev.type||'log'}</td><td style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(ev.decision||ev.error||ev.meta||ev)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-muted small">Last updated: {new Date().toLocaleTimeString()}</div>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-header">Gemini Activity</div>
              <div style={{ padding: 8, maxHeight: 260, overflow: 'auto' }}>
                {geminiLogs.slice().reverse().map((item:any, idx:number) => (
                  <div key={idx} style={{ marginBottom: 12 }}>
                    <div className="text-muted small">{new Date(item.ts).toLocaleString()}</div>
                    <div><strong>system</strong>: {String(item.system||'')}</div>
                    <div><strong>user</strong>: {String(item.user||'')}</div>
                    <div><strong>assistant</strong>: {String(item.response||'')}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-header">Ask Gemini</div>
              <div style={{ padding: 8 }}>
                <GeminiTester onDone={refresh} />
              </div>
            </div>

            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-header">Current Roster</div>
              <div style={{ padding: 8 }}>
                <div className="table-responsive">
                  <table className="table table-sm table-striped mono"><thead><tr><th>Slot</th><th>Pos</th><th>Player</th><th>Team</th></tr></thead>
                    <tbody>
                      {roster.map((e, i) => (
                        <tr key={i}><td>{e.slot||'—'}</td><td>{e.player?.position||''}</td><td>{e.player?.name||''}</td><td>{e.player?.team||''}</td></tr>
                      ))}
                    </tbody></table>
                </div>
                <div className="small" id="startersMeta"></div>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-header">League Profile (Scoring & Settings)</div>
              <div style={{ padding: 8 }}>
                <div className="mono json-pre" dangerouslySetInnerHTML={{ __html: jsonHighlightHtml(leagueProfile || {}) }} />
              </div>
            </div>

            <div className="card">
              <div className="card-header">Incoming Trades</div>
              <div style={{ padding: 8 }}>
                <table className="table table-sm table-striped mono"><thead><tr><th>ID</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {trades.map((t:any, idx:number) => (
                    <tr key={idx}><td>{t.id}</td><td>{t.status}</td><td><button className="btn btn-sm btn-outline-secondary" onClick={()=>alert(JSON.stringify(t,null,2))}>View</button>{' '}<button className="btn btn-sm btn-outline-primary" onClick={async ()=>{ const res=await fetch('/api/trades/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ leagueKey: leagueKeyInput || env.leagueKey, teamKey: teamKeyInput || env.teamKey, tradeId: t.id })}); const j=await res.json(); alert(j.ok?('Gemini: '+(j.decision?.shouldAccept?'ACCEPT':'DECLINE')):('Err:'+j.error)); }}>Evaluate</button></td></tr>
                  ))}
                </tbody></table>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function GeminiTester({ onDone }: { onDone?: ()=>void }){
  const [prompt, setPrompt] = useState('Say hello.');
  const [result, setResult] = useState('');
  async function send(){
    const r = await fetch('/api/gemini/test', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ prompt }) });
    const j = await r.json().catch(()=>({ok:false}));
    setResult(j.ok? String(j.response) : ('Error: ' + (j.error||'unknown')));
    onDone && onDone();
  }
  return (<div>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input className="form-control" value={prompt} onChange={(e)=>setPrompt(e.target.value)} />
      <button className="btn btn-primary" onClick={send}>Send</button>
    </div>
    <pre className="mono mt-2" style={{ whiteSpace: 'pre-wrap' }}>{result}</pre>
  </div>);
}
