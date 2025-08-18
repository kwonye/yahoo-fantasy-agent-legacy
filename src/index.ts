import express from 'express';
import cookieParser from 'cookie-parser';
import { router } from './routes.js';
import { scheduleJobs } from './scheduler.js';
import { logger } from './logger.js';
import { config, assertSecrets } from './config.js';
import { setNewsProvider } from './news/newsProvider.js';
import { SleeperNewsProvider } from './news/sleeperProvider.js';

assertSecrets();
const app = express();
app.use(express.json());
app.use(cookieParser());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/', router);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  logger.info(`Server listening on http://localhost:${port}`);
  // Init news provider
  if (config.newsProvider === 'sleeper') setNewsProvider(new SleeperNewsProvider());
  scheduleJobs();
});
