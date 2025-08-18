# Yahoo Fantasy Bot

Service that manages a Yahoo Fantasy Football team using the Yahoo Fantasy Sports API and Gemini for strategy suggestions (lineup, waivers, trades).

## Quick Start

1) Copy `.env.example` to `.env` and fill values.

- `YAHOO_CLIENT_ID` / `YAHOO_CLIENT_SECRET`: Create an app at https://developer.yahoo.com/apps/ (Web Application). Set the redirect URI to `http://localhost:3000/auth/callback`.
- `YAHOO_LEAGUE_KEY` and `YAHOO_TEAM_KEY`: From your Yahoo Fantasy URLs, e.g. `nfl.l.12345` and `nfl.l.12345.t.7`.
- `GEMINI_API_KEY`: REQUIRED. From Google AI Studio (https://aistudio.google.com/).

2) Optional: configure manager preferences by copying `config/app.config.example.json` to `config/app.config.json` and editing values (FAAB budget, waiver time, aggressiveness, position priorities). Env vars in `.env` override file values.

3) Install deps and run the server.

```bash
npm install
npm run dev
```

4) Authenticate with Yahoo:

- Visit `http://localhost:3000/auth/login` and complete the OAuth flow.
- Verify tokens saved: `GET http://localhost:3000/config` should show `hasTokens: true`.

## Endpoints

- `GET /health` – service liveness.
- `GET /auth/login` – start Yahoo OAuth.
- `GET /auth/callback` – finish OAuth; tokens stored in `data/tokens.json`.
- `GET /config` – show league/team keys and token presence.
- `POST /actions/lineup` – AI-assisted lineup set. Applies changes via Yahoo API.
- `POST /actions/waivers` – AI-assisted waiver add/drop (stubbed free-agent fetch).
- `POST /actions/trades` – AI-assisted trade proposal creation (sends transaction).
- `POST /actions/run-all` – runs lineup, waivers, trades sequentially.

## Scheduler

Automation runs via cron + a news poller. Set `AUTO_ENABLE=true` in `.env`.

- `LINEUP_CRON` (default `*/10 * * * *`): frequent lineup checks.
- `WAIVER_CRON` (default `5 3 * * *`): after waivers process.
- `TRADE_CRON` (default `0 9 * * *`): daily trade attempt time.
- `DAILY_CRON` (default `0 8 * * *`): daily maintenance.
- `NEWS_POLL_MIN` (default `5`): minutes between news polls.
- `NEWS_PROVIDER` (default `sleeper`): news source. Options: `sleeper`, `noop`.

All cron jobs use timezone from `TZ`.

## Notes and Next Steps

- Write operations to Yahoo require XML payloads; minimal helpers included. For production, consider a robust XML builder.
- The Yahoo Fantasy API returns XML by default; this project requests JSON via `Accept: application/json` where supported, but some responses may still need XML parsing enhancements.
- Strategy modules (`src/strategies/*`) require Gemini and produce concise JSON. Tighten prompts and guardrails as you gain data and add constraints.
- News reactions are stubbed via `src/news/newsProvider.ts`. Plug in a real provider (Sleeper, FantasyPros, NBC Edge) and return items with player names/headlines/timestamps to trigger lineup reevaluation.

## Development

- TypeScript, Express, Axios, node-cron.
- Tokens are stored in `data/tokens.json` (git-ignored). Consider moving to a proper DB.

## Tests

- Run unit tests: `npm test`
- Watch mode: `npm run test:watch`
- Covered areas: config secrets validation, Yahoo response mappers, mutex exclusivity, and Sleeper news matching.

## Run Continuously

Options:

- Docker: `docker build -t yahoo-fantasy-bot . && docker run --env-file .env -p 3000:3000 --restart unless-stopped -v $(pwd)/data:/app/data -v $(pwd)/config:/app/config:ro yahoo-fantasy-bot`
- PM2: `npm i -g pm2` then `pm2 start npm --name yahoo-fantasy-bot -- run dev` and `pm2 save`.
- systemd (example):

```
[Unit]
Description=Yahoo Fantasy Bot
After=network.target

[Service]
Environment=PORT=3000
EnvironmentFile=/path/to/.env
WorkingDirectory=/path/to/yahoo-fantasy-bot
ExecStart=/usr/bin/npm run dev
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable: `sudo systemctl enable --now yahoo-fantasy-bot.service`

## Docker Compose

See `docker-compose.example.yml`. Copy to `docker-compose.yml`, adjust, then run:

```bash
docker compose up -d --build
```
