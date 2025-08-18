import { getModel } from '../clients/gemini.js';
import { WaiverDecision, Player } from './types.js';
import { config } from '../config.js';

export async function decideWaiverAction(freeAgents: Player[], currentRoster: Player[]): Promise<WaiverDecision | null> {
  const model = getModel();
  const system = `You analyze free agents and propose high-value waiver moves for a Yahoo Fantasy Football team. Respect FAAB constraints and roster needs. Return concise JSON.`;
  const mgr = config.manager;
  const context = {
    faabBudget: mgr.faabBudget,
    weeklyFaabMax: mgr.weeklyFaabMax,
    waiverProcessTime: mgr.waiverProcessTime,
    aggressiveness: mgr.aggressiveness,
    injuryRiskTolerance: mgr.injuryRiskTolerance,
    positionPriority: mgr.positionPriority,
  };
  const prompt = `${system}\n\nContext: ${JSON.stringify(context)}\n\nFreeAgents: ${JSON.stringify(freeAgents)}\nRoster: ${JSON.stringify(currentRoster)}\n\nRespond strictly as JSON with keys: add_player_id, drop_player_id (optional), bid (optional number), rationale. If no move, return null.`;
  const text = await model.generate(prompt);
  try {
    if (text.trim() === 'null') return null;
    return JSON.parse(text) as WaiverDecision;
  } catch {
    return null;
  }
}
