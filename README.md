# Yahoo Fantasy Bot

Containerized service that manages a Yahoo Fantasy Football team using the Yahoo Fantasy Sports API and Gemini. This guide covers a full autonomous install and run using Docker only.

## Prerequisites

- Docker and Docker Compose installed.
- Yahoo Developer app (Web Application) with client ID/secret. Yahoo requires an HTTPS redirect URI.
- Gemini API key from Google AI Studio.

## Quick Start Checklist

- [ ] 1. **Create Yahoo Developer App** at [developer.yahoo.com/apps](https://developer.yahoo.com/apps/)
  - App Type: "Web Application"
  - Redirect URI: `https://localhost:3443/auth/callback`
  - API Permissions: Fantasy Sports (Read/Write)
  - Save your Client ID and Client Secret
- [ ] 2. **Get Gemini API Key** from [Google AI Studio](https://aistudio.google.com/)
- [ ] 3. **Find Your League/Team Keys** from your Yahoo Fantasy URL
  - League URL: `https://football.yahoo.com/f1/12345/1`
  - League Key: `nfl.l.12345`
  - Team Key: `nfl.l.12345.t.1` (where 1 is your team number)
- [ ] 4. **Configure Environment** (see Configure section below)
- [ ] 5. **Run Docker Compose** (see Run section below)
- [ ] 6. **Complete OAuth** by visiting `http://localhost:3000/auth/login`
- [ ] 7. **Verify Setup** at `http://localhost:3000/setup-status`

## Configure

- .env: copy `.env.example` to `.env` and fill required values:
  - `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, `YAHOO_REDIRECT_URI`
  - Optional: `YAHOO_SCOPE` (`fspt-w` for read/write, `fspt-r` for read-only)
  - `YAHOO_LEAGUE_KEY`, `YAHOO_TEAM_KEY`
  - `GEMINI_API_KEY`
  - `TZ` and cron vars
- Manager settings (optional): copy `config/app.config.example.json` to `config/app.config.json` and tweak preferences. Manager settings are configured in this file (no env overrides).

### Custom League Settings

You can provide custom league settings the bot should consider (e.g., roster positions, scoring quirks, FAAB rules) in `config/app.config.json` under a new `league` key. Example:

```json
{
  "manager": { /* existing manager config */ },
  "league": {
    "rosterPositions": ["QB","RB","RB","WR","WR","TE","FLEX","DEF","K","BN","BN","BN"],
    "flexSlots": ["RB","WR","TE"],
    "faabBudget": 200,
    "waiverType": "FAAB", // or "Priority"
    "tradeDeadlineWeek": 11,
    "scoring": {
      "passing_td": 4,
      "passing_yd": 0.04,
      "rush_td": 6,
      "rush_yd": 0.1,
      "rec_td": 6,
      "rec_yd": 0.1,
      "ppr": 0.5
    },
    "notes": "No kickers in playoffs; custom bonuses applied week 14+"
  }
}
```

- Read live Yahoo league settings: `GET http://localhost:3000/league/settings`
  - Returns `settingsRaw` (Yahoo API), `normalized` (bot-friendly schema), your `overrides`, and `effective` (normalized + overrides).
- Read only local overrides: `GET http://localhost:3000/league/settings/local`
  - Useful to verify what you configured without hitting Yahoo.

Strategies now factor your settings into decisions:
- Lineup: Considers roster slots, FLEX eligibility, scoring, manager risk tolerance.
- Waivers: Uses FAAB constraints, position priorities, and league roster rules.
- Trades: Avoids lopsided offers with scoring and roster context.

Normalized schema fields the bot uses:
- `leagueName`, `season`
- `positionCounts` and `rosterPositions` (ordered slots like `QB,RB,RB,WR,WR,TE,FLEX,...`)
- `flexSlots` (e.g., `W/R/T`)
- `benchSpots`, `irSpots`
- `waiverType` (`FAAB` or `Priority`), `faabBudget`
- `tradeDeadlineDate`
- `scoring` (map of stat name → points)

If you want the strategies (lineup/waivers/trades) to factor these settings into decisions, let’s wire them into the prompts. I can add this quickly once you confirm the fields you care about.

## Run (Docker Compose)

- Copy `docker-compose.example.yml` to `docker-compose.yml` and adjust as needed, then start:

```bash
docker compose up -d --build
docker compose logs -f
```

### Auto-Rebuild on Changes (Compose Watch)

Use Docker Compose’s watch mode to rebuild and restart automatically when sources or config change:

```bash
docker compose up --watch
```

This uses the `develop.watch` config in `docker-compose.yml` to:
- Rebuild on changes to `src`, `package.json`, `package-lock.json`, and `tsconfig.json`.
- Restart the container when `.env` changes so new env vars apply.

If your Compose version doesn’t support `--watch`, fall back to:

```bash
docker compose up -d --build
```

## First-Time Auth

- Default local HTTPS is enabled out-of-the-box on port `3443` using a self-signed certificate (auto-generated in `data/ssl`).
- You can complete Yahoo OAuth without a Gemini key; AI features require `GEMINI_API_KEY` but the server will start so you can authenticate first.

### Alternate: One-Time Env Auth Code (OOB)

You can paste a Yahoo authorization code into `.env` and let the service exchange it automatically.

- Add to `.env`:
  - `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`
  - `YAHOO_AUTH_CODE` — the one-time code you obtained from Yahoo
- Flow performed by the service:
  - POST `https://api.login.yahoo.com/oauth2/get_token`
  - Auth header: `Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)`
  - Form body: `client_id`, `client_secret`, `redirect_uri=oob`, `code=YAHOO_AUTH_CODE`, `grant_type=authorization_code`
  - On success: tokens saved to `data/tokens.json`
- Triggers:
  - Automatically on startup (once per run if `YAHOO_AUTH_CODE` present)
  - Or call: `POST http://localhost:3000/auth/use-env-code`
- After success: remove `YAHOO_AUTH_CODE` from `.env` (it’s one-time).
- Set your Yahoo app redirect to: `https://localhost:3443/auth/callback` (matches the default `.env`).
- Start the service: `docker compose up -d --build`
- In your browser:
  - Open `http://localhost:3000/auth/login` (HTTP is fine for starting the flow).
  - After Yahoo login, you will be redirected to `https://localhost:3443/auth/callback`.
  - Your browser may warn about the self-signed cert; continue to proceed.
  - Check `http://localhost:3000/config` shows `hasTokens: true`.
- After tokens exist, the container runs autonomously on the configured schedule. Set `AUTO_ENABLE=true` to also enable the news polling loop.

### Alternate Auth (No Browser Flow)

If Yahoo’s OAuth page blocks localhost for you or you prefer to paste tokens:

- Exchange a code manually:
  - Obtain an authorization `code` using your own redirect handler or tool, then call:
  - `POST /auth/exchange` with `{ "code": "..." }` to save tokens.

- Or paste tokens directly:
  - `POST /auth/tokens` with JSON body containing: `access_token`, `refresh_token`, `token_type`, `expires_in`, and optional `xoauth_yahoo_guid`.
  - Example:
    ```json
    {
      "access_token": "ya29...",
      "refresh_token": "1//...",
      "token_type": "bearer",
      "expires_in": 3600
    }
    ```
  - Verify with `GET /auth/status` (`hasTokens: true`).

Note: You still need valid `YAHOO_CLIENT_ID` and `YAHOO_CLIENT_SECRET` in `.env` for refresh to work.

## HTTPS Redirect Options

Out of the box, the container provides a self-signed HTTPS endpoint on `https://localhost:3443` suitable for Yahoo OAuth redirects. Alternatives:

- Custom local certs: Provide `SSL_CERT_PATH` and `SSL_KEY_PATH` in `.env` and set `HTTPS_PORT` as needed. Update `YAHOO_REDIRECT_URI` to match.
- Tunnel: Use an HTTPS tunnel to forward to your container (ngrok, Cloudflare Tunnel). Set `YAHOO_REDIRECT_URI` to the tunnel URL + `/auth/callback` and add it in the Yahoo app settings.

Important: The `YAHOO_REDIRECT_URI` must exactly match one of the Redirect URIs in your Yahoo Developer app.

## Updating

- Rebuild and restart:

```bash
docker compose up -d --build
```

- Volumes keep tokens and config across updates.
