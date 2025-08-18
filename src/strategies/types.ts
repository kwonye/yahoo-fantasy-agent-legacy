export type Player = {
  player_id: string;
  name: string;
  eligible_positions: string[];
  team?: string;
  status?: string;
  points?: number;
};

export type LineupDecision = {
  moves: Array<{
    player_id: string;
    to_position: string;
  }>;
  rationale: string;
};

export type WaiverDecision = {
  add_player_id: string;
  drop_player_id?: string;
  bid?: number;
  rationale: string;
};

export type TradeProposal = {
  partner_team_key: string;
  offer_player_ids: string[];
  request_player_ids: string[];
  message: string;
};

