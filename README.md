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