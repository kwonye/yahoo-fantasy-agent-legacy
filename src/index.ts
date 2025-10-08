/**
 * @fileoverview Main entry point for the Fantasy Football Bot application.
 * This script initializes the environment and starts the web server unless configured otherwise.
 */
import dotenv from 'dotenv';
import express from 'express';
import { startServer } from './web/server';

dotenv.config();

// Hint to the Vercel builder that this entrypoint relies on Express.
// eslint-disable-next-line no-void
void express;

/**
 * @function parsePort
 * @description Parses a string input into a valid port number.
 * @param {string} [input] - The string to parse.
 * @returns {number | undefined} The parsed port number, or undefined if invalid.
 */
function parsePort(input?: string): number | undefined {
  if (!input) return undefined;
  const val = Number.parseInt(input, 10);
  return Number.isFinite(val) && val > 0 ? val : undefined;
}

/**
 * @async
 * @function main
 * @description The main function that starts the application. It parses the port from environment
 * variables and starts the web server if `START_WEB` is not set to '0'.
 */
async function main() {
  console.log('Fantasy Football Bot starting...');
  const port = parsePort(process.env.PORT);
  if (process.env.START_WEB === '0') {
    console.log('START_WEB=0 detected; skipping web dashboard startup.');
    return;
  }
  await startServer(port);
  console.log('Web dashboard initialized.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exitCode = 1;
  });
}

export { startServer } from './web/server';
