import dotenv from 'dotenv';
import { BotController } from '../controllers';
import { Scheduler } from '../services/Scheduler';
import { ConfigManager } from '../services/ConfigManager';

dotenv.config();

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
