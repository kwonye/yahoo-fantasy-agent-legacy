import dotenv from 'dotenv';
import { BotController } from '../controllers';
import { Scheduler } from '../services/Scheduler';

dotenv.config();

async function runOnce() {
  const leagueKey = process.env.LEAGUE_KEY;
  const teamKey = process.env.TEAM_KEY;
  if (!leagueKey || !teamKey) {
    console.error('Missing LEAGUE_KEY or TEAM_KEY in environment');
    process.exit(1);
  }
  const bot = new BotController({ leagueKey, teamKey });
  await bot.runDaily();
}

function runScheduled() {
  const hour = parseInt(process.env.BOT_RUN_HOUR || '9', 10);
  const minute = parseInt(process.env.BOT_RUN_MINUTE || '0', 10);
  const runOnStart = /^true$/i.test(process.env.BOT_RUN_ON_START || 'true');
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

