/**
 * @fileoverview Main entry point for running the fantasy football bot.
 * This script can be run in two modes: 'once' to execute the bot's daily tasks immediately,
 * or 'schedule' to run the bot on a daily schedule based on settings.
 */
import dotenv from 'dotenv';
import { BotController } from '../controllers';
import { Scheduler } from '../services/Scheduler';
import { ConfigManager } from '../services/ConfigManager';

dotenv.config();

/**
 * @function runOnce
 * @description Instantiates the BotController and runs its main daily task loop a single time.
 * It loads necessary configuration and exits if essential keys are missing.
 */
async function runOnce() {
  const s = new ConfigManager().loadAppSettings();
  const leagueKey = s.leagueKey;
  const teamKey = s.teamKey;
  if (!leagueKey || !teamKey) {
    console.error('Missing leagueKey or teamKey in app-settings.json');
    process.exit(1);
  }
  const bot = new BotController({ leagueKey, teamKey });
  await bot.runDaily();
}

/**
 * @function runScheduled
 * @description Sets up a daily scheduler to run the bot's main task loop at a configured time.
 * It retrieves the schedule settings from the application configuration.
 */
function runScheduled() {
  const s = new ConfigManager().loadAppSettings();
  const hour = s.scheduleHour;
  const minute = s.scheduleMinute;
  const runOnStart = false;
  const task = async () => {
    await runOnce();
  };
  const scheduler = new Scheduler(task, { hour, minute, runOnStart });
  console.log(`Bot scheduled daily at ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} (runOnStart=${runOnStart})`);
  scheduler.start();
}

const mode = process.argv[2] || 'once';
if (mode === 'once') {
  runOnce().catch((e) => {
    console.error('Bot run failed:', e);
    process.exit(1);
  });
} else if (mode === 'schedule') {
  runScheduled();
} else {
  console.error(`Unknown mode: ${mode}. Use 'once' or 'schedule'.`);
  process.exit(1);
}
