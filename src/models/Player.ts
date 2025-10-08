/**
 * @fileoverview Interfaces related to players, their stats, and analysis.
 */
import { Position, PlayerStatus, Matchup } from './Common';

/**
 * @interface Player
 * @description Represents a single fantasy football player.
 * @property {string} id - The unique identifier for the player.
 * @property {string} name - The full name of the player.
 * @property {Position} position - The primary position of the player.
 * @property {string} team - The NFL team the player belongs to.
 * @property {PlayerStatus} status - The current status of the player (e.g., Active, Injured).
 * @property {Matchup} [matchup] - Information about the player's upcoming matchup.
 * @property {number} [projectedPoints] - Optional hint for projected points, used by some UIs/tests.
 * @property {number} [averagePoints] - Optional hint for average points, used by some UIs/tests.
 */
export interface Player {
  id: string;
  name: string;
  position: Position;
  team: string;
  status: PlayerStatus;
  matchup?: Matchup;
  // Optional hint used by some UIs/tests; not relied on by decision logic
  projectedPoints?: number;
  averagePoints?: number;
}

/**
 * @interface PlayerStats
 * @description Represents the statistics for a player for a specific game or week.
 * @property {string} playerId - The ID of the player these stats belong to.
 * @property {number} week - The week the stats are for.
 * @property {number} season - The season the stats are for.
 * @property {number} points - The total fantasy points scored.
 * @property {number} [passingYards] - Passing yards.
 * @property {number} [passingTouchdowns] - Passing touchdowns.
 * @property {number} [interceptions] - Interceptions thrown.
 * @property {number} [rushingYards] - Rushing yards.
 * @property {number} [rushingTouchdowns] - Rushing touchdowns.
 * @property {number} [receivingYards] - Receiving yards.
 * @property {number} [receivingTouchdowns] - Receiving touchdowns.
 * @property {number} [receptions] - Receptions.
 * @property {number} [fieldGoalsMade] - Field goals made.
 * @property {number} [fieldGoalsAttempted] - Field goals attempted.
 * @property {number} [extraPointsMade] - Extra points made.
 * @property {number} [defensivePoints] - Points scored by a team defense.
 */
export interface PlayerStats {
  playerId: string;
  week: number;
  season: number;
  points: number;
  passingYards?: number;
  passingTouchdowns?: number;
  interceptions?: number;
  rushingYards?: number;
  rushingTouchdowns?: number;
  receivingYards?: number;
  receivingTouchdowns?: number;
  receptions?: number;
  fieldGoalsMade?: number;
  fieldGoalsAttempted?: number;
  extraPointsMade?: number;
  defensivePoints?: number;
}

/**
 * @interface PlayerAnalysis
 * @description Represents an AI-driven analysis of a player's value.
 * @property {string} playerId - The ID of the player being analyzed.
 * @property {number} value - The calculated value of the player.
 * @property {number} confidence - The confidence level in the analysis (0-1).
 * @property {string} reasoning - The reasoning behind the analysis.
 * @property {string[]} riskFactors - A list of identified risk factors for the player.
 */
export interface PlayerAnalysis {
  playerId: string;
  value: number;
  confidence: number;
  reasoning: string;
  riskFactors: string[];
}
