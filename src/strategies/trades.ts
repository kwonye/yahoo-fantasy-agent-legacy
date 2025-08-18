import { getModel } from '../clients/gemini.js';
import { TradeProposal, Player } from './types.js';

export async function proposeTradeFromContext(
  myRoster: Player[],
  otherTeams: Array<{ team_key: string; roster: Player[] }>,
): Promise<TradeProposal | null> {
  const model = getModel();
  const system = `You craft mutually beneficial trade proposals for Yahoo Fantasy. Avoid lopsided or veto-bait trades. Return concise JSON.`;
  const prompt = `${system}\n\nMyRoster: ${JSON.stringify(myRoster)}\nOtherTeams: ${JSON.stringify(otherTeams)}\n\nRespond strictly as JSON with keys: partner_team_key, offer_player_ids, request_player_ids, message. If no viable trade, return null.`;
  const text = await model.generate(prompt);
  try {
    if (text.trim() === 'null') return null;
    return JSON.parse(text) as TradeProposal;
  } catch {
    return null;
  }
}
