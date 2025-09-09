import { Player } from './Player';
import { Position } from './Common';

export interface Lineup {
  starters: { [position: string]: Player };
  bench: Player[];
}

export interface LineupDecision {
  recommendedLineup: Lineup;
  changes: LineupChange[];
  confidence: number;
  reasoning: string;
  projectedPoints: number;
}

export interface LineupChange {
  position: Position;
  playerOut?: Player;
  playerIn: Player;
  reasoning: string;
  pointsImpact: number;
}
