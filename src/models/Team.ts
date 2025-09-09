import { Player } from './Player';
import { Lineup } from './Lineup';

export interface Team {
  id: string;
  name: string;
  roster: Player[];
  lineup: Lineup;
  leagueId: string;
}

export interface League {
  id: string;
  name: string;
  teams: Team[];
  settings: LeagueSettings;
  currentWeek: number;
  season: number;
}

export interface LeagueSettings {
  rosterPositions: { [position: string]: number };
  waiverType: string;
  tradeDeadline: Date;
  playoffWeeks: number[];
  scoringType: string;
}
