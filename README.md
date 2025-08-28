# Yahoo Fantasy Bot

Containerized service that manages a Yahoo Fantasy Football team using the Yahoo Fantasy Sports API and Gemini. This guide covers a full autonomous install and run using Docker only.

## Prerequisites

- Docker and Docker Compose installed.
- Yahoo Developer app (Web Application) with client ID/secret. Yahoo requires an HTTPS redirect URI.
- Gemini API key from Google AI Studio.

## Configure

- .env: copy `.env.example` to `.env` and fill required values:
  - `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, `YAHOO_REDIRECT_URI`
  - `YAHOO_LEAGUE_KEY`, `YAHOO_TEAM_KEY`
  - `GEMINI_API_KEY`
  - `TZ` and cron vars
- Manager settings (optional): copy `config/app.config.example.json` to `config/app.config.json` and tweak preferences. Env vars in `.env` override file values.

## Run (Docker Compose)

- Copy `docker-compose.example.yml` to `docker-compose.yml` and adjust as needed, then start:

```bash
docker compose up -d --build
docker compose logs -f
```

## First-Time Auth

- Default local HTTPS is enabled out-of-the-box on port `3443` using a self-signed certificate (auto-generated in `data/ssl`).
- Set your Yahoo app redirect to: `https://localhost:3443/auth/callback` (matches the default `.env`).
- Start the service: `docker compose up -d --build`
- In your browser:
  - Open `http://localhost:3000/auth/login` (HTTP is fine for starting the flow).
  - After Yahoo login, you will be redirected to `https://localhost:3443/auth/callback`.
  - Your browser may warn about the self-signed cert; continue to proceed.
  - Check `http://localhost:3000/config` shows `hasTokens: true`.
- After tokens exist, the container runs autonomously on the configured schedule. Set `AUTO_ENABLE=true` to also enable the news polling loop.

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
