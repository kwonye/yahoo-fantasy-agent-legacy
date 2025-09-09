export interface LeagueProfileMeta {
  leagueId?: string | number;
  leagueName?: string;
  leagueLogo?: string;
  customLeagueUrl?: string;
  draftType?: string;
  draftTime?: string;
  cashLeague?: boolean;
  maxTeams?: number;
  liveDraftPickTime?: string;
  scoringType?: string;
  startScoringWeek?: number;
  cantCutListProvider?: string;
  maxAcquisitionsSeason?: number | null;
  maxAcquisitionsWeek?: number | null;
  maxTradesSeason?: number | null;
  tradeEndDate?: string;
  allowDraftPickTrades?: boolean;
  tradeReview?: string;
  tradeRejectTime?: string;
  waiverTime?: string;
  waiverType?: string;
  weeklyWaivers?: string;
  allowInjuredAdds?: boolean;
  postDraftPlayers?: string;
  playoffs?: string;
  playoffTieBreaker?: string;
  playoffReseeding?: boolean;
  divisions?: boolean;
  lockEliminatedTeams?: boolean;
  applyInjuredStatusForPostponed?: boolean;
  rosterPositions?: string[] | Record<string, number>;
  fractionalPoints?: boolean;
  negativePoints?: boolean;
  lockBenchedPlayers?: boolean;
  publicViewable?: boolean;
  invitePermissions?: string;
}

export interface LeagueScoringCategory {
  name: string;
  value: string | number | null;
  yahooDefault?: string | number | null;
}

export interface LeagueScoringConfig {
  offense?: LeagueScoringCategory[];
  kickers?: LeagueScoringCategory[];
  defense?: LeagueScoringCategory[];
}

export interface LeagueProfile {
  leagueKey: string; // e.g., nfl.l.399238
  meta: LeagueProfileMeta;
  scoring: LeagueScoringConfig;
}

