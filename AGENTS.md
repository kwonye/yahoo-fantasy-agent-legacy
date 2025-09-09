# Agents Overview

This document outlines the core agents, roles, data flow, configuration, and operational details for the Fantasy Football Bot. It lives under `.kiro/` to support agent-oriented workflows and planning.

## Purpose
- Central reference for agent responsibilities and handoffs
- Quick map from high-level actions to code and env config
- Support iterative planning (see `.kiro/specs/fantasy-football-bot/tasks.md`)

## Agent Catalog

- Orchestrator: coordinates daily workflows
  - Code: `src/controllers/BotController.ts`
  - Responsibilities: schedule daily run; call lineup optimization, waivers, trade evaluation; toggle dry-run vs apply based on config.
  - Key env: `LEAGUE_KEY`, `TEAM_KEY`, `APPLY_CHANGES`

- Yahoo OAuth Agent: manages tokens
  - Code: `src/services/YahooOAuthClient.ts`
  - Responsibilities: auth URL generation; code exchange; token refresh; persistence via `ConfigManager`/`SecureStore`.
  - Key env: `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, `YAHOO_ACCESS_TOKEN?`, `YAHOO_REFRESH_TOKEN?`, `REDIRECT_URI`

- Yahoo API Agent: reads league/roster; writes changes
  - Code: `src/services/YahooApiService.ts`
  - Responsibilities: read league metadata, roster (with slot parsing), waivers/free agents; backoff/retry and debug dumps.
  - Notes: uses documented endpoints (e.g., `/league/{key}/players;status=W|FA;count`). All writes are XML-only via the Write Adapter.

- Yahoo Write Adapter: builds apply payloads
  - Code: `src/services/YahooWriteAdapter.ts`
  - Responsibilities: convert decisions to Yahoo-compatible XML payloads for lineup/transactions/trades; optional execution via `YAHOO_XML_WRITE=1`; debug dumps.
  - Policy: JSON writes are not supported. Enable `YAHOO_XML_WRITE=1` to send XML writes; otherwise dry-run only with payload dumps under `logs/yahoo_write_payloads/` when `DEBUG_YAHOO=1`.

- Decision Engine (Gemini): AI decisions
  - Code: `src/services/GeminiClient.ts`, `src/services/DecisionService.ts`
  - Responsibilities: prompt build (lineup/waiver/trade), call Gemini API, strict JSON parsing, minimal post-validation; gating by confidence/thresholds.
  - Key env: `GEMINI_API_KEY`, `GEMINI_MODEL?`
  - Logging: `logs/gemini.log` via `GeminiLog` (requests/responses, inputs snapshot)

- Configuration + Secure Storage: runtime preferences and secrets
  - Code: `src/services/ConfigManager.ts`, `src/services/SecureStore.ts`
  - Responsibilities: load/validate bot config; persist encrypted credentials; league profile migration to `config/league_setting.json`.
  - Key env: `CONFIG_ENCRYPTION_KEY` (required to use `SecureStore`), `CONFIG_DIR?`, `BOT_*` flags

- Observability: audit trail, metrics, structured logs
  - Code: `src/services/AuditTrail.ts`, `src/services/Metrics.ts`, `src/services/Logger.ts`, `src/services/GeminiLog.ts`
  - Responsibilities: append-only audit log (`logs/audit.log`), simple timers/counters, JSON console logs, Gemini request/response log.

- Web Dashboard: control plane + visibility
  - Code: `src/web/server.ts`, `src/web/client.ts`, `public/index.html`
  - Responsibilities: health, config UI, creds management, prompt preview, activity/metrics, manual bot run, schedule control.

## Data Flow

1) Orchestrator loads config and league context.
2) Yahoo API retrieves league + roster (slot-aware when available).
3) Decision Engine builds prompt and queries Gemini; returns JSON decision.
4) Orchestrator records audit events and logs results.
5) If `APPLY_CHANGES=true`, Write Adapter applies lineup/waiver/trade via Yahoo API; else dry-run only.

## Configuration

Copy `.env.example` to `.env` and set values:
- Yahoo API: `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, optional bootstrap `YAHOO_ACCESS_TOKEN`, `YAHOO_REFRESH_TOKEN`.
- Gemini: `GEMINI_API_KEY`, optional `GEMINI_MODEL` (default `gemini-1.5-flash`).
- Bot prefs: `BOT_RISK_TOLERANCE`, `BOT_TRADING_ENABLED`, `BOT_WAIVER_WIRE_ENABLED`, `BOT_MAX_WAIVER_CLAIMS`, `BOT_TRADE_THRESHOLD`, `APPLY_CHANGES`.
- Scheduling: `BOT_RUN_HOUR`, `BOT_RUN_MINUTE`, `BOT_RUN_ON_START`.
- Secure store: `CONFIG_ENCRYPTION_KEY` (32-byte hex recommended), optional `CONFIG_DIR` (defaults to `./.secure`).
- League/team: `LEAGUE_KEY`, `TEAM_KEY`.
- Misc: `DEBUG_YAHOO=1` to write debug dumps; `YAHOO_XML_WRITE=1` to attempt XML write endpoints.

## Ops Cheatsheet

- Install: `npm install`
- Build: `npm run build`
- Run bot (CLI): `npm start` (uses `LEAGUE_KEY`/`TEAM_KEY`)
- Dev mode: `npm run dev`
- Tests: `npm test`
- Web dashboard: `npm start` then browse `http://localhost:3000`
  - Health: `GET /health`
  - Bot run: `POST /api/bot/run` with `{ leagueKey, teamKey }`
  - Prompt preview: `POST /api/gemini/preview` with `{ leagueKey?, teamKey }`
    - Types: `{ type: 'lineup'|'waivers'|'trade', ... }`
    - Trade opponent: provide `theirTeamNumber` (1–10) or omit to infer next team; server returns `inferredOpponentTeamKey` when inferred
  - Activity: `GET /api/activity`
  - Metrics: `GET /api/metrics`
  - Gemini logs: `GET /api/gemini/logs`, clear via `POST /api/gemini/clear`
  - Schedule: `POST /api/schedule` with `{ enabled, hour, minute, leagueKey, teamKey }`

## Files and Logs

- Audit trail: `logs/audit.log`
- Gemini I/O: `logs/gemini.log`
- Yahoo debug dumps (if enabled): `logs/`, `logs/yahoo_write_payloads/`
- League profile: `config/league_setting.json`
- Specs/plan: `.kiro/specs/fantasy-football-bot/tasks.md`

## Safety

- Dry run by default: `APPLY_CHANGES=false` avoids modifying your team.
- Set `CONFIG_ENCRYPTION_KEY` before persisting tokens/creds; otherwise secure store is disabled.
- Logs may contain metadata; avoid including raw secrets in requests; dashboard masks creds by default.

## Extensibility

- Additional agents (e.g., matchup model, news ingestion) can plug into `DecisionService` or feed context to `GeminiClient`.
- Expand dashboard endpoints for richer review/approval flows before applying changes.
