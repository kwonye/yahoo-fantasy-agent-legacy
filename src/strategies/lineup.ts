import { getModel } from '../clients/gemini.js';
import { LineupDecision, Player } from './types.js';

export async function decideLineup(roster: Player[], matchupInfo: unknown): Promise<LineupDecision> {
  const model = getModel();
  const system = `You are an expert fantasy football assistant using Yahoo Fantasy. Suggest a valid starting lineup optimizing projected points and minimizing risk. Use concise JSON.`;
  const prompt = `${system}\n\nRoster: ${JSON.stringify(roster)}\n\nMatchup: ${JSON.stringify(matchupInfo)}\n\nRespond strictly as JSON with keys: moves (array of {player_id, to_position}) and rationale.`;
  const text = await model.generate(prompt);
  try {
    const parsed = JSON.parse(text);
    return {
      moves: Array.isArray(parsed.moves) ? parsed.moves : [],
      rationale: parsed.rationale || 'No rationale provided',
    } as LineupDecision;
  } catch {
    return { moves: [], rationale: 'Model returned non-JSON. Skipping.' };
  }
}
