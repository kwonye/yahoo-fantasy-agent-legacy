## Integration Notes

### Yahoo Fantasy API

- OAuth: Uses `YahooOAuthClient` with OAuth 2.0. Tokens are persisted via `ConfigManager` when `CONFIG_ENCRYPTION_KEY` is set.
- Base URL: `https://fantasysports.yahooapis.com/fantasy/v2`
- League info: `GET /league/{leagueKey}?format=json`. `YahooApiService.getLeague` maps both simplified shapes and Yahoo's `fantasy_content` structure.
- Team roster: `GET /team/{teamKey}/roster[;week={n}]?format=json`. `YahooApiService.getTeamRoster(teamKey, week?)` automatically derives the current week from the league when `week` is not provided, and falls back to a no-week call if needed. The parser handles Yahoo's nested `fantasy_content.team[].roster[].players[]` shape and flattens `player` arrays.

Write operations (XML-only):
- JSON writes are not supported. All writes use XML per Yahoo’s guide.
- Lineup/roster changes: `YahooWriteAdapter.buildLineupXML(assignments)` → `YahooApiService.updateRosterXml(teamKey, xml)`
- Waiver add/drop transactions: `YahooWriteAdapter.buildWaiverXML(leagueKey, decision)` → `YahooApiService.submitTransactionsXml(leagueKey, xml)`
- Trade proposals: `YahooWriteAdapter.buildTradeXML(leagueKey, decision)` → `YahooApiService.proposeTradeXml(leagueKey, xml)`
- Enable writes by setting `APPLY_CHANGES=true` and `YAHOO_XML_WRITE=1`. With `DEBUG_YAHOO=1`, XML payloads are written to `logs/yahoo_write_payloads/`.

### Dashboard

- Health/Config/Metrics/Activity cards auto-refresh.
- Credentials card shows masked values and status badges.
- Gemini Activity card displays chat-style logs of prompts/responses. Endpoints:
  - `GET /api/gemini/logs`, `POST /api/gemini/clear`
- Roster:
  - Single table, starters then bench (with separator). Starters got/required per slot summary.
  - Client does not surface projected/average points; those require separate stats endpoints.
  - Data source: `GET /api/roster?teamKey=...` (slot-aware when available).

Environment variables used by demo:
- `LEAGUE_KEY`, `TEAM_KEY`, `WEEK` (optional), `REDIRECT_URI`, `AUTH_CODE`

### Gemini API

- Client: `GeminiClient` uses `GEMINI_API_KEY` and optional `GEMINI_MODEL` (default `gemini-1.5-flash`).
- Methods: `optimizeLineup`, `evaluateWaiver`, `evaluateTrade`.
- Prompting: Uses `systemInstruction` for role separation and low temperature for determinism. Payload now includes counts and pretty‑printed JSON for key inputs (roster, league settings, preferences, context) to aid diagnostics. Lineup prompts include a compact per‑player view and a roster count; when empty, the instructions ask for a conservative no‑change JSON response.
- Context now may include a per‑league `leagueProfile` (custom scoring/settings stored under `config/leagues/{leagueKey}.json`). This object is surfaced to Gemini for more league‑aware reasoning.
- Parsing: Parser tolerates fenced JSON code blocks and extracts the first JSON object/array when needed.

#### Preview endpoints (no Gemini calls)
- `POST /api/gemini/preview` with `type`:
  - `lineup`: requires `leagueKey`, `teamKey`; returns `{ ok, system, user }` built from live league/roster.
  - `waivers`: requires `leagueKey`; uses `/league/{key}/players;status=W|FA` to build prompt; returns 400 if none available.
  - `trade`: requires `leagueKey`, `teamKey`; accepts `theirTeamNumber` (1–10) or infers next team in sequence; returns `inferredOpponentTeamKey` when inferred.

### Decision Logic

- `DecisionService` applies configuration constraints: `waiverWireEnabled`, `tradingEnabled`, `maxWaiverClaims`, `tradeThreshold`, and a `minConfidence` gate.

### Logging & Monitoring

- `Logger`: structured JSON logs with levels and service tag.
- `AuditTrail`: JSONL audit entries in `logs/audit.log` for decisions/errors.
- `Metrics`: counters and simple timing captures.

### Demo

- Run `npm run build && node dist/tools/demoYahoo.js` to exercise OAuth and Yahoo API calls.
- Set `LEAGUE_KEY` and `TEAM_KEY` in `.env`. Optionally set `WEEK` to fetch a specific week's roster.

### Bot Execution

- CLI: `npm run bot` runs a single daily cycle immediately.
- Scheduler: `npm run bot:schedule` schedules a daily run at `BOT_RUN_HOUR:BOT_RUN_MINUTE` (local time). Set `BOT_RUN_ON_START=true` to also run immediately at startup.
- Dry-run mode: Set `APPLY_CHANGES=false` (default) to avoid write operations against Yahoo. When ready to enable writes (lineup updates, waiver claims, trade proposals), set `APPLY_CHANGES=true`.

### League Profiles

- Storage: JSON files under `config/leagues/{leagueKey}.json`.
- Shape: `{ leagueKey, meta: { ... }, scoring: { offense:[], kickers:[], defense:[] } }`. The `meta` section captures league‑specific settings (waivers, playoffs, roster positions, etc.) and `scoring` captures category rules (values and Yahoo defaults when relevant).
- Semantics: For each scoring category, `yahooDefault: null` means the Yahoo default equals the current league value (i.e., not overridden). Only non‑null `yahooDefault` indicates a difference from Yahoo’s default.
- API:
  - `GET /api/league-config?leagueKey=...` → returns the profile (or null if none saved)
  - `POST /api/league-config` with body `{ leagueKey, meta, scoring }` → saves profile to disk
- Usage: The BotController loads the profile and includes it in the Gemini context as `leagueProfile` for lineup, waivers, and trade analysis.
