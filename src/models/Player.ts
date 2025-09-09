import { Position, PlayerStatus, Matchup } from './Common';

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

export interface PlayerAnalysis {
  playerId: string;
  value: number;
  confidence: number;
  reasoning: string;
  riskFactors: string[];
}
