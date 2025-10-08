/**
 * @fileoverview Interfaces related to fantasy football lineups.
 */
import { Player } from './Player';
import { Position } from './Common';

/**
 * @interface Lineup
 * @description Represents a fantasy football lineup.
 * @property {{ [position: string]: Player }} starters - A map of starting positions to players.
 * @property {Player[]} bench - A list of players on the bench.
 */
export interface Lineup {
  starters: { [position: string]: Player };
  bench: Player[];
}

/**
 * @interface LineupDecision
 * @description Represents the bot's decision for an optimal lineup.
 * @property {Lineup} recommendedLineup - The recommended lineup.
 * @property {LineupChange[]} changes - A list of changes from the current lineup.
 * @property {number} confidence - The bot's confidence in this lineup.
 * @property {string} reasoning - The reasoning for the recommended lineup.
 * @property {number} projectedPoints - The projected points for the recommended lineup.
 */
export interface LineupDecision {
  recommendedLineup: Lineup;
  changes: LineupChange[];
  confidence: number;
  reasoning: string;
  projectedPoints: number;
}

/**
 * @interface LineupChange
 * @description Represents a single change within a lineup.
 * @property {Position} position - The position affected by the change.
 * @property {Player} [playerOut] - The player being moved out of the position.
 * @property {Player} playerIn - The player being moved into the position.
 * @property {string} reasoning - The reasoning for this specific change.
 * @property {number} pointsImpact - The estimated impact on points from this change.
 */
export interface LineupChange {
  position: Position;
  playerOut?: Player;
  playerIn: Player;
  reasoning: string;
  pointsImpact: number;
}
