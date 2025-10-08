/**
 * @fileoverview Client-side TypeScript for the Yahoo Fantasy Agent dashboard.
 * This file handles all DOM manipulation, API calls from the browser, and event handling.
 */

/**
 * @typedef {HTMLElement & { value?: string; checked?: boolean }} AnyEl
 * @description A helper type for DOM elements that might have `value` or `checked` properties.
 */
type AnyEl = HTMLElement & { value?: string; checked?: boolean };

/**
 * @function $
 * @description A shorthand for `document.getElementById`.
 * @param {string} id The ID of the element to find.
 * @returns {AnyEl | null} The found element, cast to `AnyEl`, or null.
 */
const $ = (id: string) => document.getElementById(id) as AnyEl | null;

/**
 * @async
 * @function fetchJson
 * @description A wrapper around `fetch` to simplify making GET requests and parsing the response as JSON.
 * @template T The expected type of the JSON response.
 * @param {string} url The URL to fetch.
 * @returns {Promise<T>} The parsed JSON data.
 */
async function fetchJson<T = any>(url: string): Promise<T> {
  const r = await fetch(url);
  return r.json();
}

/**
 * @function setJson
 * @description Sets the text content of an element to a formatted JSON string.
 * @param {string} id The ID of the element to update.
 * @param {any} obj The object to stringify and display.
 */
function setJson(id: string, obj: any) {
  const el = $(id);
  if (el) el.textContent = JSON.stringify(obj, null, 2);
}

/**
 * @function renderActivity
 * @description Renders a list of activity events into the activity log table.
 * @param {any[]} events An array of event objects to render.
 */
function renderActivity(events: any[]) {
  const tbody = $('activity'); if (!tbody) return;
  tbody.innerHTML = '';
  for (const ev of events) {
    const tr = document.createElement('tr');
    const ts = document.createElement('td');
    const ty = document.createElement('td');
    const dt = document.createElement('td');
    const time = new Date(ev.ts || ev.time || Date.now()).toLocaleString();
    ts.textContent = time; ty.textContent = ev.type || 'log'; dt.textContent = JSON.stringify(ev.decision || ev.error || ev.meta || ev);
    tr.append(ts, ty, dt); (tbody as HTMLElement).appendChild(tr);
  }
}

/**
 * @function setBadges
 * @description Updates the status badges on the dashboard based on the current configuration and credentials.
 * @param {any} cfg The application configuration object.
 * @param {any} creds The credentials status object.
 */
function setBadges(cfg: any, creds: any) {
  const mode = $('modeBadge');
  if (mode) {
    if (cfg?.applyChanges) { mode.className='badge bg-danger'; mode.textContent='Mode: Live Writes'; }
    else { mode.className='badge bg-secondary'; mode.textContent='Mode: Dry Run'; }
  }
  const yb = $('yahooBadge'); const gb = $('geminiBadge');
  if (yb) { if (creds?.creds?.yahoo) { yb.className='badge bg-success'; yb.textContent='Yahoo: OK'; } else { yb.className='badge bg-warning text-dark'; yb.textContent='Yahoo: Missing'; } }
  if (gb) { if (creds?.creds?.gemini) { gb.className='badge bg-success'; gb.textContent='Gemini: OK'; } else { gb.className='badge bg-warning text-dark'; gb.textContent='Gemini: Missing'; } }
}

/**
 * @function setCredsSummary
 * @description Updates the credentials summary section with the status of Yahoo and Gemini credentials.
 * @param {any} creds The credentials status object.
 */
function setCredsSummary(creds: any) {
  const yb = $('credsYahooBadge'); const gb = $('credsGeminiBadge'); const details = $('credsDetails');
  const y = creds?.creds?.yahoo; const g = creds?.creds?.gemini;
  if (yb) yb.className = y ? 'badge bg-success' : 'badge bg-warning text-dark'; if (yb) yb.textContent = y ? 'Yahoo: OK' : 'Yahoo: Missing';
  if (gb) gb.className = g ? 'badge bg-success' : 'badge bg-warning text-dark'; if (gb) gb.textContent = g ? 'Gemini: OK' : 'Gemini: Missing';
  if (details) details.textContent = JSON.stringify({ yahoo: y||null, gemini: g||null }, null, 2);
}

/**
 * @function setMetricsSummary
 * @description Updates the metrics summary section with the latest bot performance metrics.
 * @param {any} m The metrics object from the API.
 */
function setMetricsSummary(m: any) {
  const el = $('metrics'); if (!el) return;
  const meta = m?.metrics || {};
  el.textContent = [
    'Decisions: ' + (meta.decisions ?? 0),
    'Actions: ' + (meta.actions ?? 0),
    'Errors: ' + (meta.errors ?? 0),
    'By Type: ' + JSON.stringify(meta.byType || {}),
  ].join('\n');
}

/**
 * @function lsGet
 * @description A safe wrapper for `localStorage.getItem`.
 * @param {string} key The key to retrieve.
 * @param {string} [def=''] The default value if the key is not found.
 * @returns {string} The retrieved value or the default.
 */
function lsGet(key: string, def = ''): string { try { const v = localStorage.getItem(key); return v===null? def : v; } catch { return def; } }

/**
 * @function lsSet
 * @description A safe wrapper for `localStorage.setItem`.
 * @param {string} key The key to set.
 * @param {string} val The value to set.
 */
function lsSet(key: string, val: string) { try { localStorage.setItem(key, val); } catch {} }

/**
 * @async
 * @function fillEnvPanel
 * @description Fetches the current environment settings from the API and populates the settings form fields.
 */
async function fillEnvPanel() {
  const env = await fetchJson('/api/env');
  const leagueEl = $('leagueKeyInput'); const teamEl = $('teamKeyInput');
  const schedOnEl = $('scheduleEnabled'); const schedHourEl = $('scheduleHour'); const schedMinEl = $('scheduleMinute');
  if (leagueEl) leagueEl.value = env.leagueKey || '';
  if (teamEl) teamEl.value = env.teamKey || '';
  if (schedOnEl) schedOnEl.checked = !!(env.schedule && env.schedule.enabled);
  if (schedHourEl) schedHourEl.value = String(env.schedule?.hour ?? '');
  if (schedMinEl) schedMinEl.value = String(env.schedule?.minute ?? '');
  const lk = lsGet('leagueKey',''); if (lk && leagueEl) leagueEl.value = lk;
  const tk = lsGet('teamKey',''); if (tk && teamEl) teamEl.value = tk;
  const se = lsGet('scheduleEnabled',''); if (se && schedOnEl) schedOnEl.checked = se==='1';
  const sh = lsGet('scheduleHour',''); if (sh && schedHourEl) schedHourEl.value = sh;
  const sm = lsGet('scheduleMinute',''); if (sm && schedMinEl) schedMinEl.value = sm;
}

/**
 * @async
 * @function refreshGemini
 * @description Fetches and renders the latest Gemini API interaction logs.
 */
async function refreshGemini() {
  const chat = $('geminiChat'); if (!chat) return;
  chat.innerHTML = '';
  const r = await fetchJson('/api/gemini/logs');
  const logs = r.logs || [];
  for (const item of logs) {
    const wrap = document.createElement('div'); wrap.className='mb-3';
    const ts = document.createElement('div'); ts.className='text-muted small'; ts.textContent = new Date(item.ts).toLocaleString();
    const sys = document.createElement('div'); sys.innerHTML = '<strong>system</strong>: ' + escapeHtml(item.system || '');
    const user = document.createElement('div'); user.innerHTML = '<strong>user</strong>: ' + escapeHtml(item.user || '');
    const resp = document.createElement('div'); resp.innerHTML = '<strong>assistant</strong>: ' + escapeHtml(item.response || '');
    wrap.append(ts, sys, user, resp); chat.appendChild(wrap);
  }
}

/**
 * @function escapeHtml
 * @description Escapes a string for safe insertion into HTML.
 * @param {string} s The string to escape.
 * @returns {string} The escaped string.
 */
function escapeHtml(s: string): string { return String(s).replace(/[&<>\"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'} as any)[c]); }

/**
 * @async
 * @function refreshRoster
 * @description Fetches the team roster from the API and renders it in the UI.
 */
async function refreshRoster() {
  const leagueKey = (($('leagueKeyInput')||{}) as AnyEl).value || '';
  const teamKey = (($('teamKeyInput')||{}) as AnyEl).value || '';
  const enrich = ($('enrichProj') && (($('enrichProj') as AnyEl).checked)) ? 1 : 0;
  const q = teamKey ? `?teamKey=${encodeURIComponent(teamKey)}${enrich ? '&enrich=1' : ''}` : (enrich ? '?enrich=1' : '');
  try {
    const data = await fetchJson('/api/roster' + q);
    const entries: any[] = data.roster || [];
    const starters = entries.filter(e => e.slot && e.slot !== 'BN' && e.slot !== 'IR');
    const bench = entries.filter(e => !e.slot || e.slot === 'BN' || e.slot === 'IR');
    const tbl = $('rosterCombinedTbl'); if (!tbl) return; tbl.innerHTML = '';
    const addRow = (e: any) => {
      const tr = document.createElement('tr');
      const slot = document.createElement('td'); slot.textContent = e.slot || '—';
      const pos = document.createElement('td'); pos.textContent = e.player?.position || '';
      const name = document.createElement('td'); name.textContent = e.player?.name || '';
      const team = document.createElement('td'); team.textContent = e.player?.team || '';
      tr.append(slot, pos, name, team); tbl.appendChild(tr);
    };
    starters.forEach(addRow);
    const sepTr = document.createElement('tr'); const sepTd = document.createElement('td'); sepTd.colSpan = 4; sepTd.innerHTML = '<hr class="m-0">';
    sepTr.append(sepTd); tbl.appendChild(sepTr);
    bench.forEach(addRow);
    const countBy = (arr: any[]) => arr.reduce((m, e) => { const k = e.slot || '—'; m[k] = (m[k]||0)+1; return m; }, {} as Record<string, number>);
    const startersCounts = countBy(starters);
    const startersMetaEl = $('startersMeta');
    try {
      const lkp = ((($('leagueKeyInput')||{}) as AnyEl).value) || (await fetchJson('/api/env')).leagueKey;
      if (lkp) {
        const lr = await fetchJson('/api/league?leagueKey=' + encodeURIComponent(lkp));
        const req = lr?.league?.settings?.rosterPositions || {};
        const parts: string[] = [];
        Object.entries(req).forEach(([slot, needed]: any) => {
          if (slot==='BN' || slot==='IR') return;
          const got = startersCounts[slot] || 0;
          const ok = got >= needed; const cls = ok ? 'text-success' : 'text-danger';
          parts.push(`<span class="${cls}">${slot}:${got}/${needed}</span>`);
        });
        if (startersMetaEl) startersMetaEl.innerHTML = parts.join(' ');
      }
    } catch { if (startersMetaEl) startersMetaEl.textContent = Object.entries(startersCounts).map(([k,v]) => `${k}:${v}`).join(' '); }
    const rm = $('rosterMeta'); if (rm) rm.textContent = `${entries.length} players`;
  } catch (e) { console.error('Failed to load roster', e); }
}

/**
 * @async
 * @function refreshAll
 * @description A main refresh function that calls all other refresh functions to update the entire dashboard.
 */
async function refreshAll() {
  try {
    setJson('health', await fetchJson('/health'));
    
    const cfg = await fetchJson('/api/config'); setJson('config', cfg);
    const creds = await fetchJson('/api/creds'); const cs = $('credsStatus'); if (cs) cs.textContent = JSON.stringify(creds?.creds||{}, null, 2); setCredsSummary(creds);
    setBadges(cfg, creds);
    setMetricsSummary(await fetchJson('/api/metrics'));
    const act = await fetchJson('/api/activity'); renderActivity(act.events || []);
    await refreshGemini();
    const lu = $('lastUpdated'); if (lu) lu.textContent = 'Last updated: ' + new Date().toLocaleTimeString();
    await fillEnvPanel();
    await refreshRoster();
    await refreshLeagueProfile();
  } catch (e) { console.error(e); }
}


/**
 * @function initHandlers
 * @description Initializes all event handlers for the dashboard's interactive elements.
 */
function initHandlers() {
  
  
  $('yahooForm')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const body = { clientId: ( $('yClientId') as AnyEl ).value || '', clientSecret: ( $('yClientSecret') as AnyEl ).value || '' };
    const r = await fetch('/api/creds/yahoo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); alert(j.ok ? 'Yahoo creds saved' : 'Save failed: ' + j.error); refreshAll();
  });
  $('geminiForm')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const body = { apiKey: ( $('gApiKey') as AnyEl ).value || '', model: ( $('gModel') as AnyEl ).value || '' };
    const r = await fetch('/api/creds/gemini', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); alert(j.ok ? 'Gemini settings saved' : 'Save failed: ' + j.error); refreshAll();
  });
  $('runBotForm')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const leagueKey = ( $('leagueKeyInput') as AnyEl ).value || ''; const teamKey = ( $('teamKeyInput') as AnyEl ).value || '';
    lsSet('leagueKey', leagueKey); lsSet('teamKey', teamKey);
    const r = await fetch('/api/bot/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueKey, teamKey }) }); const j = await r.json(); alert(j.ok ? 'Bot run complete' : 'Run failed: ' + j.error); refreshAll();
  });
  $('refreshBtn')?.addEventListener('click', refreshAll);
  $('refreshGeminiBtn')?.addEventListener('click', refreshGemini);
  $('clearGeminiBtn')?.addEventListener('click', async () => { await fetch('/api/gemini/clear', { method: 'POST' }); await refreshGemini(); });
  // League Profile handlers
  $('lpLoadBtn')?.addEventListener('click', refreshLeagueProfile);
  $('lpPrefillBtn')?.addEventListener('click', async () => {
    const lk = await getLeagueKeyForConfig();
    const sample = sampleLeagueProfile(lk || '');
    lpEnterEdit(sample);
  });
  $('lpEditBtn')?.addEventListener('click', async () => {
    const r: any = await fetchJson('/api/league-config');
    const prof = r && r.profile ? r.profile : null;
    if (prof) lpEnterEdit(prof); else alert('No profile found yet. Use Prefill Sample to create one.');
  });
  $('lpSaveBtn')?.addEventListener('click', lpSave);
  $('lpCancelBtn')?.addEventListener('click', refreshLeagueProfile);
  (function initEnrichToggle(){ const el = $('enrichProj') as AnyEl | null; if (!el) return; const saved = lsGet('enrichProj'); if (saved) el.checked = saved==='1'; el.addEventListener('change', ()=>{ lsSet('enrichProj', el.checked ? '1':'0'); refreshRoster(); }); })();
  $('geminiTestBtn')?.addEventListener('click', async () => {
    const el = $('geminiTestInput') as AnyEl | null; const prompt = (el && el.value) ? el.value : 'Say hello.';
    const r = await fetch('/api/gemini/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
    const j = await r.json(); const out = $('geminiTestResult'); if (out) out.textContent = j.ok ? j.response : 'Error: ' + j.error; await refreshGemini();
  });
  const autoEl = $('autoRefresh') as AnyEl | null; if (autoEl) { const savedAuto = lsGet('autoRefresh','1'); autoEl.checked = savedAuto==='1'; }
  let timer: any = null; function updateTimer(){ if (timer) { clearInterval(timer); timer=null; } if (autoEl && autoEl.checked) timer = setInterval(refreshAll, 5000); }
  updateTimer(); autoEl?.addEventListener('change', ()=>{ lsSet('autoRefresh', autoEl.checked ? '1' : '0'); updateTimer(); });
  $('scheduleForm')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const enabled = !!( ($('scheduleEnabled') as AnyEl)?.checked ); const hour = parseInt( ( ($('scheduleHour') as AnyEl)?.value || '0'), 10 ); const minute = parseInt( ( ($('scheduleMinute') as AnyEl)?.value || '0'), 10 ); const leagueKey = ( $('leagueKeyInput') as AnyEl )?.value || ''; const teamKey = ( $('teamKeyInput') as AnyEl )?.value || '';
    lsSet('scheduleEnabled', enabled ? '1':'0'); lsSet('scheduleHour', String(hour)); lsSet('scheduleMinute', String(minute));
    const r = await fetch('/api/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, hour, minute, leagueKey, teamKey }) }); const j = await r.json(); alert(j.ok ? 'Schedule updated' : 'Update failed: ' + j.error); refreshAll();
  });
}

document.addEventListener('DOMContentLoaded', () => { initHandlers(); refreshAll(); });

// If Yahoo auth is missing, redirect to login page for setup
(async () => {
  try {
    // Don't run on login page
    if (location.pathname.toLowerCase().includes('/login')) return;
    // Avoid immediate redirect right after a successful connect
    if (new URLSearchParams(location.search).get('yahoo') === 'connected') return;
    const r = await fetch('/api/creds');
    const j = await r.json();
    const y = j && j.creds && j.creds.yahoo;
    if (!y) {
      // No Yahoo client creds at all – go to login
      location.href = '/login.html';
      return;
    }
    if (!y.hasRefresh) {
      // Has client ID/secret but not connected yet – send to login for connect
      location.href = '/login.html';
    }
  } catch {}
})();

// No env prefill; Yahoo creds must be saved via dashboard (secure store)

// Handle post-OAuth success indicator in URL
(() => {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('yahoo') === 'connected') {
      setTimeout(() => alert('Yahoo connected successfully.'), 50);
      params.delete('yahoo');
      const url = window.location.pathname + (params.toString() ? ('?' + params.toString()) : '');
      window.history.replaceState({}, document.title, url);
    }
  } catch {}
})();

/**
 * @async
 * @function getLeagueKeyForConfig
 * @description A helper function to get the currently configured league key from the backend.
 * @returns {Promise<string>} The league key.
 */
async function getLeagueKeyForConfig(): Promise<string> {
  try { const env = await fetchJson('/api/env'); return env.leagueKey || ''; } catch { return ''; }
}

/**
 * @async
 * @function refreshLeagueProfile
 * @description Fetches and displays the league profile configuration.
 */
async function refreshLeagueProfile() {
  const view = $('leagueProfileView');
  if (!view) return;
  try {
    const r: any = await fetchJson('/api/league-config');
    const prof = r && r.ok !== false ? r.profile : null;
    if (!prof) {
      view.innerHTML = '<div class="text-muted">No profile found yet.</div>';
      return;
    }
    setJson('leagueProfileView', prof);
    const edit = $('leagueProfileEdit') as AnyEl | null;
    if (edit) edit.style.display = 'none';
    (view as AnyEl).style.display = 'block';
    const sv = $('lpSaveBtn') as AnyEl | null; if (sv) sv.style.display = 'none';
    const ca = $('lpCancelBtn') as AnyEl | null; if (ca) ca.style.display = 'none';
  } catch {
    view.innerHTML = '<div class="text-danger">Failed to load league profile</div>' as any;
  }
}

/**
 * @function sampleLeagueProfile
 * @description Generates a sample league profile object.
 * @param {string} leagueKey The league key to include in the profile.
 * @returns {object} A sample league profile.
 */
function sampleLeagueProfile(leagueKey: string) {
  const meta = { leagueId:'399238', leagueName:'DG', leagueLogo:'', customLeagueUrl:'https://football.fantasysports.yahoo.com/league/dg2', draftType:'Live Standard Draft', draftTime:'Wed Sep 3 5:45pm PDT', cashLeague:false, maxTeams:12, liveDraftPickTime:'1 Minute, 45 Seconds', scoringType:'Head-to-Head', startScoringWeek:1, cantCutListProvider:'Yahoo Sports', maxAcquisitionsSeason:null as any, maxAcquisitionsWeek:null as any, maxTradesSeason:null as any, tradeEndDate:'2025-11-22', allowDraftPickTrades:false, tradeReview:'Commissioner', tradeRejectTime:'2 days', waiverTime:'1 day', waiverType:'FAB w/ Reverse order of standings tiebreak', weeklyWaivers:'Game Time - Tuesday', allowInjuredAdds:true, postDraftPlayers:'Free Agents', playoffs:'4 teams - Week 16 and 17 (ends Monday, Dec 29)', playoffTieBreaker:'Best regular season record vs opponent wins', playoffReseeding:true, divisions:false, lockEliminatedTeams:true, applyInjuredStatusForPostponed:false, rosterPositions:['QB','WR','WR','WR','RB','RB','TE','W/R/T','W/R/T','K','DEF','BN','BN','BN','BN','BN','IR'], fractionalPoints:true, negativePoints:true, lockBenchedPlayers:false, publicViewable:false, invitePermissions:'All Managers Can Invite' };
  const offense = [ {name:'Passing Yards', value:'25 yards per point; 2 points at 350 yards; 1 points at 400 yards'}, {name:'Passing Touchdowns', value:6, yahooDefault:4}, {name:'Interceptions', value:-2, yahooDefault:-1}, {name:'Rushing Yards', value:'10 yards per point; 2 points at 100 yards; 1 points at 150 yards'}, {name:'Rushing Touchdowns', value:6}, {name:'Receptions', value:1, yahooDefault:0.5}, {name:'Receiving Yards', value:'10 yards per point; 2 points at 125 yards; 1 points at 175 yards'}, {name:'Receiving Touchdowns', value:6}, {name:'Return Yards', value:'20 yards per point; 1 points at 100 yards', yahooDefault:0}, {name:'Return Touchdowns', value:6}, {name:'2-Point Conversions', value:2}, {name:'Fumbles Lost', value:-2}, {name:'Offensive Fumble Return TD', value:6} ];
  const kickers = [ {name:'Field Goals 0-19 Yards', value:3}, {name:'Field Goals 20-29 Yards', value:3}, {name:'Field Goals 30-39 Yards', value:3}, {name:'Field Goals 40-49 Yards', value:4}, {name:'Field Goals 50+ Yards', value:5}, {name:'Field Goals Missed 0-19 Yards', value:-3, yahooDefault:0}, {name:'Field Goals Missed 20-29 Yards', value:-2, yahooDefault:0}, {name:'Field Goals Missed 30-39 Yards', value:-1, yahooDefault:0}, {name:'Field Goals Missed 40-49 Yards', value:0}, {name:'Field Goals Missed 50+ Yards', value:0} ];
  const defense = [ {name:'Sack', value:1}, {name:'Interception', value:2}, {name:'Fumble Recovery', value:2}, {name:'Touchdown', value:6}, {name:'Safety', value:4, yahooDefault:2}, {name:'Block Kick', value:4, yahooDefault:2}, {name:'Kickoff and Punt Return Touchdowns', value:6}, {name:'Points Allowed 0 points', value:10}, {name:'Points Allowed 1-6 points', value:7}, {name:'Points Allowed 7-13 points', value:5, yahooDefault:4}, {name:'Points Allowed 14-20 points', value:2, yahooDefault:1}, {name:'Points Allowed 21-27 points', value:0}, {name:'Points Allowed 28-34 points', value:-2, yahooDefault:-1}, {name:'Points Allowed 35+ points', value:-5, yahooDefault:-4}, {name:'4th Down Stops', value:2, yahooDefault:0}, {name:'Extra Point Returned', value:2} ];
  return { leagueKey, meta, scoring: { offense, kickers, defense } };
}

/**
 * @function lpEnterEdit
 * @description Enters the league profile editing mode.
 * @param {any} jsonObj The league profile object to edit.
 */
function lpEnterEdit(jsonObj: any){
  const view = $('leagueProfileView') as AnyEl | null; const edit = $('leagueProfileEdit') as AnyEl | null;
  if (!edit || !view) return;
  edit.value = JSON.stringify(jsonObj, null, 2);
  view.style.display = 'none'; edit.style.display = 'block';
  const sv = $('lpSaveBtn') as AnyEl | null; if (sv) sv.style.display = 'inline-block';
  const ca = $('lpCancelBtn') as AnyEl | null; if (ca) ca.style.display = 'inline-block';
}

/**
 * @async
 * @function lpSave
 * @description Saves the edited league profile to the backend.
 */
async function lpSave(){
  const edit = $('leagueProfileEdit') as AnyEl | null;
  const leagueKey = await getLeagueKeyForConfig();
  if (!edit) return;
  try {
    const obj = JSON.parse(edit.value || '{}');
    (obj as any).leagueKey = (obj as any).leagueKey || leagueKey;
    const r = await fetch('/api/league-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
    const j = await r.json(); if (!j.ok) throw new Error(j.error || 'Save failed');
    alert('League profile saved'); await refreshLeagueProfile();
  } catch (e: any) {
    alert('Save error: ' + (e && e.message ? e.message : String(e)));
  }
}
