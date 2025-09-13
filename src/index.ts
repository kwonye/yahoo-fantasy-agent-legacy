// Main entry point for the Fantasy Football Bot
import dotenv from 'dotenv';


dotenv.config();

function mask(val?: string): string {
  if (!val) return '';
  if (val.length <= 6) return '*'.repeat(val.length);
  return `${val.slice(0, 3)}***${val.slice(-3)}`;
}

async function main() {
  console.log('Fantasy Football Bot starting...');

  
  
  

  

  // App ready; subsequent tasks will orchestrate bot operations
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
