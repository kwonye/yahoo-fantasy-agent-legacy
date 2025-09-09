// Common types and enums used across the application

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

export enum PlayerStatus {
  ACTIVE = 'ACTIVE',
  INJURED = 'INJURED',
  OUT = 'OUT',
  QUESTIONABLE = 'QUESTIONABLE',
  DOUBTFUL = 'DOUBTFUL',
  BYE = 'BYE',
}

export enum DecisionType {
  LINEUP_CHANGE = 'LINEUP_CHANGE',
  WAIVER_CLAIM = 'WAIVER_CLAIM',
  TRADE_PROPOSAL = 'TRADE_PROPOSAL',
  DROP_PLAYER = 'DROP_PLAYER',
}

export enum RiskLevel {
  CONSERVATIVE = 'CONSERVATIVE',
  MODERATE = 'MODERATE',
  AGGRESSIVE = 'AGGRESSIVE',
}

export interface Matchup {
  opponent: string;
  isHome: boolean;
  gameTime: Date;
  weather?: string;
  spread?: number;
  overUnder?: number;
}
