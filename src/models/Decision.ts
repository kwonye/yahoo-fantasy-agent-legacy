import { DecisionType } from './Common';
import { Player } from './Player';

export interface BotDecision {
  id: string;
  type: DecisionType;
  timestamp: Date;
  reasoning: string;
  confidence: number;
  executed: boolean;
  outcome?: string;
}

export interface WaiverClaim {
  playerId: string;
  dropPlayerId?: string;
  priority: number;
  reasoning: string;
  bidAmount?: number; // optional FAAB bid (if applicable)
}

export interface WaiverDecision {
  claims: WaiverClaim[];
  reasoning: string;
  confidence: number;
  expectedValue: number;
}

export interface TradeProposal {
  myPlayers: string[];
  theirPlayers: string[];
  targetTeamId: string;
  reasoning: string;
}

export interface TradeDecision {
  proposal?: TradeProposal;
  proposals?: TradeProposal[]; // optional: allow multiple proposed trades
  shouldTrade: boolean;
  reasoning: string;
  confidence: number;
  expectedValue: number;
}

export interface BotReport {
  week: number;
  decisions: BotDecision[];
  performance: PerformanceMetrics;
  summary: string;
}

export interface PerformanceMetrics {
  lineupOptimizationSuccess: number;
  waiverWireHitRate: number;
  tradeSuccessRate: number;
  totalPointsGained: number;
  weeklyRanking: number;
}
