/**
 * @fileoverview Common types and enums used across the application.
 */

/**
 * @enum {string}
 * @description Represents the possible positions for a player in a fantasy football lineup.
 */
export enum Position {
  QB = 'QB',
  RB = 'RB',
  WR = 'WR',
  TE = 'TE',
  K = 'K',
  DEF = 'DEF',
  FLEX = 'FLEX',
  BENCH = 'BENCH',
}

/**
 * @enum {string}
 * @description Represents the possible status of a player.
 */
export enum PlayerStatus {
  ACTIVE = 'ACTIVE',
  INJURED = 'INJURED',
  OUT = 'OUT',
  QUESTIONABLE = 'QUESTIONABLE',
  DOUBTFUL = 'DOUBTFUL',
  BYE = 'BYE',
}

/**
 * @enum {string}
 * @description Represents the type of decision made by the bot.
 */
export enum DecisionType {
  LINEUP_CHANGE = 'LINEUP_CHANGE',
  WAIVER_CLAIM = 'WAIVER_CLAIM',
  TRADE_PROPOSAL = 'TRADE_PROPOSAL',
  DROP_PLAYER = 'DROP_PLAYER',
}

/**
 * @enum {string}
 * @description Represents the risk level for a decision.
 */
export enum RiskLevel {
  CONSERVATIVE = 'CONSERVATIVE',
  MODERATE = 'MODERATE',
  AGGRESSIVE = 'AGGRESSIVE',
}

/**
 * @interface Matchup
 * @description Represents a matchup for a team or player.
 * @property {string} opponent - The name of the opponent.
 * @property {boolean} isHome - Whether the game is at home.
 * @property {Date} gameTime - The date and time of the game.
 * @property {string} [weather] - The weather forecast for the game.
 * @property {number} [spread] - The point spread for the game.
 * @property {number} [overUnder] - The over/under for the game.
 */
export interface Matchup {
  opponent: string;
  isHome: boolean;
  gameTime: Date;
  weather?: string;
  spread?: number;
  overUnder?: number;
}
