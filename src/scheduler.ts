import cron from 'node-cron';
import { runLineup, runTrade, runWaivers } from './services/managerService.js';
import { logger } from './logger.js';
import { config } from './config.js';
import { Mutex } from './util/mutex.js';
import { getTeamRoster } from './clients/yahooFantasy.js';
import { mapPlayersFromRosterResponse } from './clients/yahooParsers.js';
import { getNewsProvider } from './news/newsProvider.js';

export function scheduleJobs() {
  // Use env-configurable crons. All jobs are serialized through a mutex.
  const mutex = new Mutex();

  const safeRun = (name: string, fn: () => Promise<void>) => async () => {
    await mutex.runExclusive(async () => {
      logger.info(`Job start: ${name}`);
      try {
        await fn();
        logger.info(`Job done: ${name}`);
      } catch (err) {
        logger.error(`Job error: ${name}`, err);
      }
    });
  };

  const tzOpt = { timezone: config.timezone } as const;

  // Daily maintenance
  cron.schedule(config.cron.daily, safeRun('daily', async () => {
    await runLineup();
    await runWaivers();
    await runTrade();
  }), tzOpt);

  // Frequent lineup check
  cron.schedule(config.cron.lineup, safeRun('lineup', async () => {
    await runLineup();
  }), tzOpt);

  // Waiver processing window
  cron.schedule(config.cron.waivers, safeRun('waivers', async () => {
    await runWaivers();
  }), tzOpt);

  // Trade attempts
  cron.schedule(config.cron.trades, safeRun('trades', async () => {
    await runTrade();
  }), tzOpt);

  // News poller to react to late-breaking changes
  if (config.autoEnable && config.teamKey) {
    let lastNewsTs = Math.floor(Date.now() / 1000) - 3600; // last hour
    const minutes = Math.max(1, config.cron.newsPollMinutes);
    const intervalMs = minutes * 60 * 1000;
    setInterval(safeRun('news-poll', async () => {
      const rosterRaw = await getTeamRoster(config.teamKey!);
      const roster = mapPlayersFromRosterResponse(rosterRaw);
      const names = roster.map((p) => p.name);
      const news = await getNewsProvider().fetchPlayerNews(names, lastNewsTs);
      if (news.length) {
        logger.info(`News items detected: ${news.length}. Reevaluating lineup.`);
        await runLineup();
        lastNewsTs = Math.floor(Date.now() / 1000);
      }
    }), intervalMs);
  }
}
