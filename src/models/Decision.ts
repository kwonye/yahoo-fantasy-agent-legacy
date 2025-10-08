/**
 * @fileoverview Interfaces related to bot decisions and reports.
 */
import { DecisionType } from './Common';
import { Player } from './Player';

/**
 * @interface BotDecision
 * @description Represents a single decision made by the bot.
 * @property {string} id - A unique identifier for the decision.
 * @property {DecisionType} type - The type of decision.
 * @property {Date} timestamp - The time the decision was made.
 * @property {string} reasoning - The reasoning behind the decision.
 * @property {number} confidence - The bot's confidence in the decision (0-1).
 * @property {boolean} executed - Whether the decision was executed.
 * @property {string} [outcome] - The outcome of the decision, if executed.
 */
export interface BotDecision {
  id: string;
  type: DecisionType;
  timestamp: Date;
  reasoning: string;
  confidence: number;
  executed: boolean;
  outcome?: string;
}

/**
 * @interface WaiverClaim
 * @description Represents a single waiver wire claim.
 * @property {string} playerId - The ID of the player to add.
 * @property {string} [dropPlayerId] - The ID of the player to drop.
 * @property {number} priority - The priority of the claim.
 * @property {string} reasoning - The reasoning for this specific claim.
 * @property {number} [bidAmount] - The FAAB bid amount, if applicable.
 */
export interface WaiverClaim {
  playerId: string;
  dropPlayerId?: string;
  priority: number;
  reasoning: string;
  bidAmount?: number; // optional FAAB bid (if applicable)
}

/**
 * @interface WaiverDecision
 * @description Represents the bot's overall decision on waiver claims for a week.
 * @property {WaiverClaim[]} claims - An ordered list of waiver claims.
 * @property {string} reasoning - The overall reasoning for the set of claims.
 * @property {number} confidence - The bot's confidence in this set of claims.
 * @property {number} expectedValue - The expected value or benefit of these claims.
 */
export interface WaiverDecision {
  claims: WaiverClaim[];
  reasoning: string;
  confidence: number;
  expectedValue: number;
}

/**
 * @interface TradeProposal
 * @description Represents a trade proposal to another team.
 * @property {string[]} myPlayers - The players to be traded from the bot's team.
 * @property {string[]} theirPlayers - The players to be received from the other team.
 * @property {string} targetTeamId - The ID of the team to trade with.
 * @property {string} reasoning - The reasoning for proposing this trade.
 */
export interface TradeProposal {
  myPlayers: string[];
  theirPlayers: string[];
  targetTeamId: string;
  reasoning: string;
}

/**
 * @interface TradeDecision
 * @description Represents the bot's decision on whether to propose a trade.
 * @property {TradeProposal} [proposal] - The single best trade proposal.
 * @property {TradeProposal[]} [proposals] - Optional list of multiple trade proposals.
 * @property {boolean} shouldTrade - Whether the bot decided to propose a trade.
 * @property {string} reasoning - The reasoning behind the decision to trade or not.
 * @property {number} confidence - The bot's confidence in the trade decision.
 * @property {number} expectedValue - The expected value or benefit of the trade.
 */
export interface TradeDecision {
  proposal?: TradeProposal;
  proposals?: TradeProposal[]; // optional: allow multiple proposed trades
  shouldTrade: boolean;
  reasoning: string;
  confidence: number;
  expectedValue: number;
}

/**
 * @interface BotReport
 * @description A report summarizing the bot's activities and performance for a week.
 * @property {number} week - The week the report is for.
 * @property {BotDecision[]} decisions - A list of all decisions made during the week.
 * @property {PerformanceMetrics} performance - Performance metrics for the week.
 * @property {string} summary - A summary of the week's activities.
 */
export interface BotReport {
  week: number;
  decisions: BotDecision[];
  performance: PerformanceMetrics;
  summary: string;
}

/**
 * @interface PerformanceMetrics
 * @description Metrics to evaluate the bot's performance.
 * @property {number} lineupOptimizationSuccess - A measure of how successful lineup optimizations were.
 * @property {number} waiverWireHitRate - The success rate of waiver wire claims.
 * @property {number} tradeSuccessRate - The success rate of proposed trades.
 * @property {number} totalPointsGained - The total fantasy points gained from bot decisions.
 * @property {number} weeklyRanking - The team's rank in the league for the week.
 */
export interface PerformanceMetrics {
  lineupOptimizationSuccess: number;
  waiverWireHitRate: number;
  tradeSuccessRate: number;
  totalPointsGained: number;
  weeklyRanking: number;
}
