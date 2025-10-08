/**
 * @fileoverview Command-line tool for manually setting a Yahoo Fantasy Football lineup.
 * This script allows a user to specify player-to-position assignments directly from the command line.
 */
import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import fs from 'fs';
import { ConfigManager } from '../services/ConfigManager';
import { YahooOAuthClient } from '../services/YahooOAuthClient';
import { YahooApiService } from '../services/YahooApiService';
import { YahooWriteAdapter, LineupAssignment } from '../services/YahooWriteAdapter';

/**
 * @interface CliOptions
 * @description Defines the command-line options available for the script.
 * @property {number} [week] - The fantasy week to apply the lineup for.
 * @property {string} [teamKey] - The Yahoo team key to apply the lineup to.
 * @property {string} [leagueKey] - The Yahoo league key.
 * @property {boolean} [dryRun] - If true, prints the XML payload without sending it.
 * @property {boolean} [showRoster] - If true, displays the current roster before exiting.
 */
interface CliOptions {
  week?: number;
  teamKey?: string;
  leagueKey?: string;
  dryRun?: boolean;
  showRoster?: boolean;
}

/**
 * @function printUsage
 * @description Prints the command-line usage instructions to the console.
 */
function printUsage() {
  const script = path.basename(__filename);
  console.log(`Manual lineup writer
Usage: ts-node ${script} [options] SLOT=PLAYER_ID [...]

Options:
  --team=<teamKey>       Override team key from config/app-settings.json
  --league=<leagueKey>   Override league key (used to derive game key/week)
  --week=<number>        Specify week (defaults to league current week)
  --dry-run              Print the XML payload only, do not send to Yahoo
  --show-roster          Display the current roster with slots before exiting
  --help                 Show this message

Examples:
  ts-node ${script} W/R/T=30136 BN=34112
  ts-node ${script} --dry-run QB=31833 WR=33393
`);
}

/**
 * @function parseArgs
 * @description Parses command-line arguments into structured assignments and options.
 * @param {string[]} argv - The array of command-line arguments.
 * @returns {{ assignments: LineupAssignment[]; options: CliOptions }} The parsed assignments and options.
 */
function parseArgs(argv: string[]): { assignments: LineupAssignment[]; options: CliOptions } {
  const assignments: LineupAssignment[] = [];
  const options: CliOptions = {};

  for (const arg of argv) {
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--show-roster') {
      options.showRoster = true;
      continue;
    }
    if (arg.startsWith('--week=')) {
      const value = Number.parseInt(arg.slice(7), 10);
      if (Number.isFinite(value)) options.week = value;
      continue;
    }
    if (arg.startsWith('--team=')) {
      options.teamKey = arg.slice(7);
      continue;
    }
    if (arg.startsWith('--league=')) {
      options.leagueKey = arg.slice(9);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq > 0) {
      const slot = arg.slice(0, eq).trim().toUpperCase();
      const playerId = arg.slice(eq + 1).trim();
      if (!slot || !playerId) {
        console.warn(`Skipping invalid assignment: ${arg}`);
        continue;
      }
      assignments.push({ position: slot, playerId });
      continue;
    }
    console.warn(`Unrecognized argument: ${arg}`);
  }

  return { assignments, options };
}

/**
 * @function main
 * @description The main execution function for the script. It parses arguments,
 * initializes API clients, and applies the specified lineup changes.
 */
async function main() {
  const { assignments, options } = parseArgs(process.argv.slice(2));

  const manager = new ConfigManager();
  const app = manager.loadAppSettings();
  const teamKey = options.teamKey || app.teamKey;

  if (!teamKey) {
    console.error('Team key missing. Provide via --team or config/app-settings.json.');
    process.exit(1);
  }

  const oauth = new YahooOAuthClient(manager);
  const api = new YahooApiService(oauth);
  const adapter = new YahooWriteAdapter(api, { dumpDir: path.join(process.cwd(), 'logs', 'yahoo_write_payloads') });

  if (options.showRoster) {
    const rosterWithSlots = await api.getTeamRosterWithSlots(teamKey);
    console.log('Current roster with slots:');
    console.log(JSON.stringify(rosterWithSlots, null, 2));
    if (assignments.length === 0 && !options.dryRun) return;
  }

  if (assignments.length === 0) {
    console.error('No assignments provided. Add SLOT=PLAYER_ID pairs or use --show-roster.');
    process.exit(1);
  }

  if (options.dryRun) {
    const xml = adapter.buildLineupXML(teamKey, assignments, options.week);
    console.log('Dry run: generated XML payload');
    console.log(xml);
    return;
  }

  const result = await api.updateRosterAssignments(teamKey, assignments, { week: options.week });
  console.log('Yahoo response:', { success: result.success, week: result.week });
  if (result.xml) {
    const xmlPath = path.join(process.cwd(), 'logs', 'yahoo_write_payloads');
    try {
      if (!fs.existsSync(xmlPath)) fs.mkdirSync(xmlPath, { recursive: true });
      const file = path.join(xmlPath, `${Date.now()}_manual_lineup.xml`);
      fs.writeFileSync(file, result.xml, 'utf8');
      console.log(`Saved XML payload to ${file}`);
    } catch (e) {
      console.warn('Unable to persist XML payload:', (e as Error).message);
    }
  }

  const updated = await api.getTeamRosterWithSlots(teamKey);
  console.log('Updated roster with slots:');
  console.log(JSON.stringify(updated, null, 2));
}

main().catch((e) => {
  console.error('applyLineup failed:', e);
  process.exit(1);
});
