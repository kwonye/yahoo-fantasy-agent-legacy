# Project Overview: Yahoo Fantasy Agent

This project is an automated fantasy football bot designed to manage a team using the Yahoo Fantasy Sports API and Google's Gemini AI. Its primary goal is to automate various aspects of fantasy football team management, including lineup optimization, waiver wire monitoring, trade evaluation, and providing a web dashboard for activity monitoring.

## Technologies Used

*   **Language**: TypeScript
*   **Runtime**: Node.js
*   **Web Framework**: Express.js
*   **AI Integration**: Google Gemini AI
*   **API Integration**: Yahoo Fantasy Sports API
*   **Testing**: Jest
*   **Linting**: ESLint
*   **Formatting**: Prettier

## Building and Running

### Setup

1.  **Install Dependencies**:
    ```bash
    npm install
    ```
2.  **Environment Variables**: Copy the example environment file and configure your API credentials.
    ```bash
    cp .env.example .env
    ```
3.  **Build Project**: Compile the TypeScript code.
    ```bash
    npm run build
    ```

### Running the Bot

*   **Start the Bot (Production)**: Runs the compiled JavaScript code.
    ```bash
    npm start
    ```
*   **Start the Bot (Development)**: Runs the bot in development mode with `nodemon` for automatic restarts on file changes.
    ```bash
    npm run dev
    ```
*   **Run Bot Once**: Executes the bot's logic a single time.
    ```bash
    npm run bot
    ```
*   **Run Bot with Scheduler**: Executes the bot's logic based on a defined schedule.
    ```bash
    npm run bot:schedule
    ```
*   **Run Yahoo Demo**: Executes a demonstration of Yahoo API interactions.
    ```bash
    npm run demo
    ```

### Running the Web Dashboard

*   **Start Web Server (Production)**: Runs the compiled web server.
    ```bash
    npm run web
    ```
*   **Start Web Server (Development)**: Runs the web server in development mode with `nodemon`.
    ```bash
    npm run web:dev
    ```

## Development Conventions

### Testing

*   **Run Tests**: Executes all tests using Jest.
    ```bash
    npm test
    ```
*   **Run Tests (Watch Mode)**: Runs tests in watch mode, re-running on file changes.
    ```bash
    npm test --watch
    ```

### Code Quality

*   **Linting**: Checks code for style and potential errors using ESLint.
    ```bash
    npm run lint
    ```
*   **Fix Linting Issues**: Automatically fixes linting issues where possible.
    ```bash
    npm run lint:fix
    ```
*   **Formatting**: Formats code using Prettier.
    ```bash
    npm run format
    ```

### TypeScript Configuration

The project uses strict TypeScript compilation settings, including:
*   `target`: ES2020
*   `module`: commonjs
*   `outDir`: `./dist`
*   `rootDir`: `./src`
*   `strict`: true
*   `esModuleInterop`: true
*   `skipLibCheck`: true

## Project Structure

*   `src/controllers/`: Bot controllers and orchestration logic.
*   `src/models/`: TypeScript interfaces and types for data structures.
*   `src/services/`: Integrations with external APIs (e.g., Yahoo, Gemini) and core business logic.
*   `src/tools/`: Utility scripts for running the bot or demos.
*   `src/web/`: Web server and client-side code for the dashboard.
*   `src/index.ts`: Main entry point for the bot application.
*   `tests/`: Contains all unit and integration tests.
*   `config/`: Configuration files for the application.
*   `public/`: Static assets for the web dashboard.
