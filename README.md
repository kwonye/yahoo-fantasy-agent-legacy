# Yahoo Fantasy Agent: Your AI-Powered Fantasy Football Assistant

Welcome to the **Yahoo Fantasy Agent**, an automated fantasy football bot designed to give you a competitive edge. This tool leverages the **Yahoo Fantasy Sports API** for league data and actions, and **Google's Gemini AI** for intelligent decision-making. It automates team management tasks, provides a web dashboard for monitoring, and helps you dominate your league.

![Dashboard Screenshot](https://raw.githubusercontent.com/CJEgg/yahoo-fantasy-agent/main/public/screenshot.png)

## Core Features

-   🤖 **AI-Powered Lineup Optimization**: Automatically sets your optimal lineup each day based on player status, matchups, and projections.
-   🕵️ **Waiver Wire Automation**: Monitors the waiver wire and free agency, making intelligent claims and pickups based on your team's needs.
-   🤝 **Trade Evaluation & Proposals**:
    -   Analyzes your roster to identify needs and surpluses.
    -   Evaluates potential trades with every other team in the league.
    -   Automatically proposes trades that benefit your team.
    -   Evaluates and responds to incoming trade offers from other managers.
-   🚑 **Automated Roster Hygiene**:
    -   Moves players to/from Injured Reserve (IR) slots to free up roster space.
    -   Optimizes FLEX positions to give you the most flexibility for last-minute changes.
-   🌐 **Web Dashboard**: A comprehensive dashboard to monitor bot activity, view logs, manage settings, and manually trigger actions.
-   🔒 **Secure Credential Management**: Encrypts your API keys and tokens, supporting both local file storage and remote KV stores (like Vercel KV or Upstash).
-   🐳 **Docker Support**: Includes production-ready and development Docker configurations for easy deployment.

## How It Works

The agent is built with a modular architecture:

-   **Express.js Web Server**: Provides a web dashboard (`/src/web`) for configuration, monitoring, and manual control. It serves a simple vanilla TypeScript frontend.
-   **Bot Controller**: The core logic orchestrator (`/src/controllers/BotController.ts`) that runs all the automated tasks.
-   **Service Layer**: A collection of services (`/src/services`) that handle specific functionalities:
    -   `YahooApiService`: Interacts with the Yahoo Fantasy API for reading league data.
    -   `YahooWriteAdapter`: Formats and sends write requests (lineup changes, trades) to the Yahoo API.
    -   `GeminiClient`: Communicates with Google's Gemini AI for decision-making.
    -   `DecisionService`: A layer on top of `GeminiClient` that applies business logic and validation to AI outputs.
    -   `ConfigManager`: Manages all configuration, including API keys and user settings.
    -   `Scheduler`: Manages the daily schedule for bot tasks.
    -   `KickoffScheduler`: Schedules tasks to run just before NFL game kickoffs.
-   **Tools**: Standalone scripts (`/src/tools`) for running the bot, testing API connections, or performing one-off tasks.

## 1. Getting Started: Setup & Configuration

### Prerequisites

-   [Node.js](https://nodejs.org/) (v18 or later)
-   [npm](https://www.npmjs.com/)
-   **Yahoo Fantasy API Credentials**:
    1.  Go to the [Yahoo Developer Network](https://developer.yahoo.com/apps/).
    2.  Click "Create an App".
    3.  Fill out the form:
        -   **Application Name**: e.g., "My Fantasy Bot"
        -   **Application Type**: "Installed App"
        -   **Description**: Your bot's description.
        -   **API Permissions**: Select "Fantasy Sports" with "Read/Write" access.
    4.  After creation, you will receive a **Client ID** and **Client Secret**.
-   **Google Gemini API Key**:
    1.  Go to [Google AI Studio](https://aistudio.google.com/).
    2.  Click "Get API key" and create a new key.

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/CJEgg/yahoo-fantasy-agent.git
    cd yahoo-fantasy-agent
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up configuration files:**
    -   **Environment Variables**: Copy the example `.env` file. This is primarily used for the `CONFIG_ENCRYPTION_KEY`.
        ```bash
        cp .env.example .env
        ```
        Open `.env` and set `CONFIG_ENCRYPTION_KEY` to a long, random string. This key encrypts your API credentials on disk. You can generate one with: `openssl rand -hex 32`

    -   **Application Settings**: The bot is primarily configured via the web dashboard, which saves to `config/app-settings.json`.
    -   **League Settings**: The bot needs to know your league's specific scoring and roster rules. A `league_setting.json` file must be placed in the `config/` directory. An example file is provided in `config/league_setting.example.json`.

4.  **Build the project:**
    ```bash
    npm run build
    ```

## 2. Running the Application

The application consists of two main parts: the **Web Dashboard** and the **Bot Runtime**.

1.  **Start the Web Dashboard:**
    This runs the Express server, which provides the UI for managing the bot.
    ```bash
    npm run web:dev
    ```
    The dashboard will be available at `http://localhost:3000`.

2.  **Configure Credentials and Settings in the Dashboard:**
    -   Open your browser to `http://localhost:3000`.
    -   Navigate to the **Credentials** page and enter your **Yahoo Client ID/Secret** and your **Gemini API Key**.
    -   Navigate to the **Settings** page:
        -   Enter your **League Key** (e.g., `nfl.l.123456`) and **Team Key** (e.g., `nfl.l.123456.t.1`).
        -   Click **"Connect Yahoo"** to complete the OAuth authentication.
        -   Enable the desired automation features and schedulers.
        -   **Crucially, toggle "Apply Changes" to `ON` to allow the bot to make live changes to your team.** By default, it runs in "dry-run" mode.

3.  **Run the Bot:**
    You can run the bot in two ways:
    -   **Manually**: Trigger a one-time run of all daily tasks from the dashboard or via the command line:
        ```bash
        npm run bot
        ```
    -   **On a Schedule**: Enable the schedulers on the dashboard. The main bot logic will run daily at the configured time, with other tasks (like kickoff checks) running on their own schedules.

## Available Scripts

-   `npm run build`: Compiles the TypeScript project to JavaScript in `dist/`.
-   `npm start`: Starts the web server from the compiled `dist/` output.
-   `npm run dev`: Starts the web server in development mode with `ts-node` and `nodemon` for live reloading.
-   `npm run bot`: Executes a single, one-time run of the bot's daily tasks.
-   `npm run bot:schedule`: Runs the bot in scheduled mode (legacy, now managed by the web server).
-   `npm run demo`: A script to test Yahoo API connectivity.
-   `npm test`: Runs all tests with Jest.
-   `npm run lint`: Lints the code with ESLint.
-   `npm run format`: Formats the code with Prettier.

## Project Structure

```
.
├── config/                 # Configuration files (app settings, league profile)
├── public/                 # Static assets for the web dashboard (HTML, CSS)
├── src/
│   ├── controllers/        # High-level orchestration logic (BotController)
│   ├── models/             # TypeScript interfaces and type definitions
│   ├── services/           # API clients, schedulers, and core logic services
│   ├── tools/              # Standalone command-line scripts
│   └── web/                # Express server and client-side TypeScript for the dashboard
├── tests/                  # Unit and integration tests
├── .env.example            # Example environment variables
├── Dockerfile              # Production Docker build
└── package.json
```

## Docker Deployment

The repository is set up for easy deployment with Docker.

1.  **Create your `.env` file:**
    ```bash
    cp .env.example .env
    ```
    Set `CONFIG_ENCRYPTION_KEY` to a strong, unique secret.

2.  **Build and run the container:**
    ```bash
    docker compose up --build -d
    ```
    This will build the production image and start the container in detached mode.

3.  **Access the Dashboard:**
    The dashboard will be available at `https://localhost:3000`. HTTPS is enabled by default in the Docker setup. If certs are not found in `config/certs`, self-signed certificates will be generated automatically.

-   **Data Persistence**: The `docker-compose.yml` file uses bind mounts to persist important data on your host machine:
    -   `./config:/app/config`
    -   `./logs:/app/logs`
    -   `./.secure:/app/.secure` (for encrypted credentials)

## Contributing

Contributions are welcome! Please follow these guidelines:
-   Fork the repository and create a new branch.
-   Ensure your code adheres to the existing style and conventions.
-   Run `npm run lint` and `npm run format` before committing.
-   Make sure all tests pass with `npm test`.
-   Submit a pull request with a clear description of your changes.