# Fantasy Football Bot

An automated fantasy football bot that manages your team using Yahoo Fantasy Sports API and Google's Gemini AI.

## Features

- Automatic lineup optimization
- Waiver wire monitoring and claims
- Trade evaluation and proposals
- Configurable risk tolerance and preferences
- Web dashboard for monitoring bot activity

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy environment variables:
   ```bash
   cp .env.example .env
   ```

3. Configure your API credentials in `.env`

4. Build the project:
   ```bash
   npm run build
   ```

5. Run the bot:
   ```bash
   npm start
   ```

## Development

- `npm run dev` - Run in development mode
- `npm test` - Run tests
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

## Project Structure

```
src/
├── controllers/    # Bot controllers and orchestration
├── models/        # TypeScript interfaces and types
├── services/      # External API integrations
└── index.ts       # Main entry point

tests/             # Test files
```

## Docker (Production)

The repo includes a slim, production-ready Dockerfile and a docker-compose.yml to get you running quickly.

### Quick Start

1) Copy the example env and set required values:

```
cp .env.example .env
```

At minimum set:

- `CONFIG_ENCRYPTION_KEY` – a strong key to encrypt credentials (e.g., output of `openssl rand -hex 32`)
  (Set Gemini API key in the dashboard under Credentials.)

2) Bring up the stack (builds the production image):

```
docker compose up --build
```

3) Open the dashboard:

- http://localhost:3000

Notes:

- The dashboard runs over HTTP. Configure your Yahoo OAuth redirect URL with `https` even though the local server is HTTP.
- Data persists via bind mounts:
  - `config/` – league settings and other config files
  - `logs/` – server and Yahoo/Gemini logs
  - `.secure/` – encrypted credentials (Yahoo/Gemini)
- For actual Yahoo writes, enable “Apply Changes” from the dashboard (Features). Yahoo writes always use XML.

### Dev Compose (optional)

An additional `docker-compose.example.yml` is provided for a dev workflow with bind‑mounted source and live reload. Copy and adapt as needed:

```
cp docker-compose.example.yml docker-compose.dev.yml
```

Run with:

```
docker compose -f docker-compose.dev.yml up --build
```

## Environment Variables (Common)

- `CONFIG_ENCRYPTION_KEY` – required to encrypt credentials in `.secure/`.
- Gemini API key is saved via the dashboard (Credentials) and not read from environment.
  Toggle “Apply Changes” from the dashboard (Features) to perform live writes.
  (Yahoo writes always use XML; no separate env variable required.)
