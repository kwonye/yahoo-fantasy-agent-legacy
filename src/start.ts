import { startServer } from './index.js';
import { authViaCLI } from './clients/yahooAuth.js';
import { logger } from './logger.js';

async function main() {
  try {
    await authViaCLI();
    logger.info('Yahoo authentication successful.');
    startServer();
  } catch (error) {
    logger.error('Failed to start the application:', error);
    process.exit(1);
  }
}

main();
