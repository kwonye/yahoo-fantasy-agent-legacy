# Agent Guide

This guide orients an AI agent working on this project. It describes current architecture, conventions, live endpoints, and required behaviors (including keeping documentation up-to-date).

## Core Principles

- Always update documentation as you modify or add functionality. In particular, keep these files current:
  - `.kiro/specs/fantasy-football-bot/tasks.md` (status + scope)
  - `.kiro/specs/fantasy-football-bot/integration-notes.md` (APIs, flows, UI, config)
  - This `AGENT_GUIDE.md` for process changes that impact future agents.
- Prefer incremental, test-backed changes. All tests must pass after your edits.
- Use dry-run mode (`APPLY_CHANGES=false`) for live testing to avoid destructive writes.
- Log enough detail to audit decisions and API interactions without leaking secrets.

## Repository Map (relevant parts)

- `src/models/*`: TypeScript interfaces and enums (Player, Team, Lineup, Decision, Config,...)
- `src/services/`:
  - `ConfigManager`: Env + encrypted storage + file-backed preferences
  - `SecureStore`: AES-256-GCM encryption for credentials on disk
  - `YahooOAuthClient`: OAuth 2.0 (token exchange + refresh)
  - `YahooApiService`: Yahoo read APIs (league, roster, waiver players); robust mappers
  - `YahooWriteAdapter`: Scaffolding to generate and (optionally) send write payloads (lineup, waivers, trade)
  - `GeminiClient`: Gemini API wrapper + prompt builders; logs calls via `GeminiLog`
  - `GeminiLog`: Append-only log for Gemini prompts/responses
  - `DecisionService`: Combines config + Gemini advice into actionable decisions (lineup/waivers/trades)
  - `Logger`, `AuditTrail`, `Metrics`, `Scheduler`: telemetry + scheduling
- `src/controllers/BotController`: Orchestrates daily flow; respects dry-run
- `src/web/server.ts`: Express API + static dashboard
- `public/index.html`: Dashboard UI
- `tests/**`: Jest tests across layers

## Running Locally

- Build: `npm run build`
- Dashboard: `npm run web` → http://localhost:3000
- Bot (once): `npm run bot`
- Bot (schedule): `npm run bot:schedule`

## Environment

- Yahoo: `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET` (+ optional tokens for bootstrap)
- Gemini: `GEMINI_API_KEY` (+ optional `GEMINI_MODEL`)
- Bot prefs (selected): `APPLY_CHANGES` (default false), `BOT_*` flags; file overrides at `config/bot-config.json`
- Secure store: `CONFIG_ENCRYPTION_KEY` (to store creds encrypted in `.secure/`)
- Debug: `DEBUG_YAHOO=1` to dump Yahoo JSON and write payloads under `logs/`
- Optional: `YAHOO_XML_WRITE=1` to execute XML write scaffolds (keep off unless you intend to test writes)

## HTTP Endpoints (Express)

- Health: `GET /health`
- Config: `GET/POST /api/config` (POST body `{ bot: Partial<BotConfig> }`)
- Credentials: `GET /api/creds`, `POST /api/creds/yahoo`, `POST /api/creds/gemini`
- Activity: `GET /api/activity`, Metrics: `GET /api/metrics`, Clear: `POST /api/logs/clear`
- Bot: `POST /api/bot/run`
- League: `GET /api/league?leagueKey=...`
- Roster: `GET /api/roster?teamKey=...&enrich=1` (enrich currently adds weekly projections when available; opponent enrichment has been removed)
- Gemini Logs: `GET /api/gemini/logs`, `POST /api/gemini/clear`

## Dashboard UX Summary

- Navbar badges show mode (dry-run vs live) and credential status
- Cards: Health, Config (raw), Metrics (summary), Activity (audit trail)
- Gemini Activity (chat-style): shows system prompt, user prompt, and assistant response of Gemini calls
- Roster:
  - Left: single table; starters first, separator, then bench; beneath, starters got/required per slot (green/red)
  - Right: projections table with Pos/Player/Proj; Opp is not populated now (intentionally removed)
- Credentials & Config: forms to update, plus manual “Run Bot Now” and scheduler controls

## Design Notes & Current Constraints

- Yahoo reads are robustly mapped across nested array/object structures; dump raw JSON with `DEBUG_YAHOO=1` before changing parsers
- Write operations are gated by `APPLY_CHANGES` and wired through `YahooWriteAdapter`. Payloads are scaffolds; refine to match Yahoo specs when moving to full writes
- Gemini calls are logged to `logs/gemini.log` to provide traceability in the dashboard

## Agent Workflow Expectations

1. Read `.kiro/specs/fantasy-football-bot/tasks.md` and update statuses as work progresses.
2. Before coding, refine design in `.kiro/specs/fantasy-football-bot/integration-notes.md`.
3. Implement minimal, test-backed changes; ensure `npm test` is green.
4. Update the dashboard (if needed) and keep endpoints documented.
5. After changes, update all relevant .kiro/specs docs (this guide, tasks, integration notes) with specifics of what changed and how to use it.

## Adding Features

- Prefer read-first flows with dumps enabled to learn shapes, then implement mappers with fallbacks.
- For Gemini-backed features, log the prompts/responses via `GeminiLog` so they appear in the dashboard.
- If you add server endpoints or UI elements, document them under Integration Notes and this guide.

