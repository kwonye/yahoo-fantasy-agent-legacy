/**
 * @fileoverview Interfaces for storing detailed league profile information.
 */

/**
 * @interface LeagueProfileMeta
 * @description Contains metadata and settings for a fantasy league.
 * @property {string | number} [leagueId] - The ID of the league.
 * @property {string} [leagueName] - The name of the league.
 * @property {string} [leagueLogo] - URL of the league's logo.
 * @property {string} [customLeagueUrl] - A custom URL for the league.
 * @property {string} [draftType] - The type of draft (e.g., 'Auction', 'Live').
 * @property {string} [draftTime] - The scheduled time for the draft.
 * @property {boolean} [cashLeague] - Whether it is a cash league.
 * @property {number} [maxTeams] - The maximum number of teams in the league.
 * @property {string} [liveDraftPickTime] - The time allowed per pick in a live draft.
 * @property {string} [scoringType] - The type of scoring (e.g., 'head').
 * @property {number} [startScoringWeek] - The week the league starts scoring.
 * @property {string} [cantCutListProvider] - The provider of the 'can't cut' list.
 * @property {number | null} [maxAcquisitionsSeason] - The maximum number of acquisitions per season.
 * @property {number | null} [maxAcquisitionsWeek] - The maximum number of acquisitions per week.
 * @property {number | null} [maxTradesSeason] - The maximum number of trades per season.
 * @property {string} [tradeEndDate] - The deadline for trades.
 * @property {boolean} [allowDraftPickTrades] - Whether trading draft picks is allowed.
 * @property {string} [tradeReview] - The trade review process (e.g., 'League Votes').
 * @property {string} [tradeRejectTime] - The time allowed to reject a trade.
 * @property {string} [waiverTime] - The time waivers are processed.
 * @property {string} [waiverType] - The type of waiver system (e.g., 'FAAB').
 * @property {string} [weeklyWaivers] - The days of the week waivers are processed.
 * @property {boolean} [allowInjuredAdds] - Whether adding injured players is allowed.
 * @property {string} [postDraftPlayers] - How post-draft players are handled (e.g., 'Free Agents').
 * @property {string} [playoffs] - Information about the playoff format.
 * @property {string} [playoffTieBreaker] - The tie-breaker for playoff games.
 * @property {boolean} [playoffReseeding] - Whether playoff teams are re-seeded.
 * @property {boolean} [divisions] - Whether the league uses divisions.
 * @property {boolean} [lockEliminatedTeams] - Whether eliminated teams' rosters are locked.
 * @property {boolean} [applyInjuredStatusForPostponed] - Whether injured status applies to postponed games.
 * @property {string[] | Record<string, number>} [rosterPositions] - The roster positions and their limits.
 * @property {boolean} [fractionalPoints] - Whether fractional points are used.
 * @property {boolean} [negativePoints] - Whether negative points are allowed.
 * @property {boolean} [lockBenchedPlayers] - Whether benched players are locked at game time.
 * @property {boolean} [publicViewable] - Whether the league is publicly viewable.
 * @property {string} [invitePermissions] - Who has permission to invite new members.
 */
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

/**
 * @interface LeagueScoringCategory
 * @description Represents a single scoring category in the league.
 * @property {string} name - The name of the scoring category (e.g., 'Passing Yards').
 * @property {string | number | null} value - The point value for the category.
 * @property {string | number | null} [yahooDefault] - The default Yahoo value for the category.
 */
export interface LeagueScoringCategory {
  name: string;
  value: string | number | null;
  yahooDefault?: string | number | null;
}

/**
 * @interface LeagueScoringConfig
 * @description Represents the scoring configuration for different player types.
 * @property {LeagueScoringCategory[]} [offense] - Scoring settings for offensive players.
 * @property {LeagueScoringCategory[]} [kickers] - Scoring settings for kickers.
 * @property {LeagueScoringCategory[]} [defense] - Scoring settings for team defenses.
 */
export interface LeagueScoringConfig {
  offense?: LeagueScoringCategory[];
  kickers?: LeagueScoringCategory[];
  defense?: LeagueScoringCategory[];
}

/**
 * @interface LeagueProfile
 * @description Represents the complete profile for a fantasy league.
 * @property {string} leagueKey - The unique key for the league (e.g., 'nfl.l.399238').
 * @property {LeagueProfileMeta} meta - The metadata and settings for the league.
 * @property {LeagueScoringConfig} scoring - The scoring configuration for the league.
 */
export interface LeagueProfile {
  leagueKey: string; // e.g., nfl.l.399238
  meta: LeagueProfileMeta;
  scoring: LeagueScoringConfig;
}

