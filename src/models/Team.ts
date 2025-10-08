/**
 * @fileoverview Interfaces related to teams, leagues, and their settings.
 */
import { Player } from './Player';
import { Lineup } from './Lineup';

/**
 * @interface Team
 * @description Represents a single fantasy football team.
 * @property {string} id - The unique identifier for the team.
 * @property {string} name - The name of the team.
 * @property {Player[]} roster - The list of players on the team's roster.
 * @property {Lineup} lineup - The current lineup for the team.
 * @property {string} leagueId - The ID of the league the team belongs to.
 */
export interface Team {
  id: string;
  name: string;
  roster: Player[];
  lineup: Lineup;
  leagueId: string;
}

/**
 * @interface League
 * @description Represents a fantasy football league.
 * @property {string} id - The unique identifier for the league.
 * @property {string} name - The name of the league.
 * @property {Team[]} teams - A list of all teams in the league.
 * @property {LeagueSettings} settings - The settings for the league.
 * @property {number} currentWeek - The current week of the fantasy season.
 * @property {number} season - The year of the current season.
 */
export interface League {
  id: string;
  name: string;
  teams: Team[];
  settings: LeagueSettings;
  currentWeek: number;
  season: number;
}

/**
 * @interface LeagueSettings
 * @description Represents the settings for a fantasy league.
 * @property {{ [position: string]: number }} rosterPositions - A map of roster positions to the number of players allowed for that position.
 * @property {string} waiverType - The type of waiver system used (e.g., 'FAAB', 'Waiver Priority').
 * @property {Date} tradeDeadline - The date of the trade deadline.
 * @property {number[]} playoffWeeks - An array of weeks that constitute the playoffs.
 * @property {string} scoringType - The scoring type for the league (e.g., 'head', 'point').
 */
export interface LeagueSettings {
  rosterPositions: { [position: string]: number };
  waiverType: string;
  tradeDeadline: Date;
  playoffWeeks: number[];
  scoringType: string;
}
