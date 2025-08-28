import { getModel } from '../clients/gemini.js';
import { Player } from './types.js';
import { config } from '../config.js';

export type DraftSuggestion = {
  picks: Array<{ player_id: string; reason?: string }>;
  rationale: string;
};

export function computePositionNeeds(rosterPositions?: string[], currentRoster?: Player[]) {
  const needs: Record<string, number> = {};
  if (rosterPositions) {
    for (const pos of rosterPositions) needs[pos] = (needs[pos] || 0) + 1;
  }
  if (currentRoster && currentRoster.length) {
    for (const p of currentRoster) {
      const primary = p.eligible_positions?.[0];
      if (primary && needs[primary] && needs[primary] > 0) needs[primary] -= 1;
    }
  }
  return needs;
}

export async function suggestDraftPicks(
  availablePlayers: Player[],
  opts: {
    leagueSettings?: any;
    currentRoster?: Player[]; // picks so far for my team, if known
    top?: number;
  } = {},
): Promise<DraftSuggestion> {
  const model = getModel();
  const { leagueSettings, currentRoster, top = 5 } = opts;
  const system = `You are an expert Yahoo Fantasy Football draft assistant. Suggest the best available picks considering roster needs, positional scarcity, and league scoring. Return concise JSON.`;
  const context = {
    manager: config.manager,
    leagueSettings: leagueSettings ?? null,
    rosterNeeds: computePositionNeeds(leagueSettings?.rosterPositions, currentRoster),
    top,
  };
  const prompt = `${system}\n\nContext: ${JSON.stringify(context)}\n\nAvailablePlayers: ${JSON.stringify(availablePlayers)}\n\nRespond strictly as JSON with keys: picks (array of {player_id, reason}) and rationale.`;
  const text = await model.generate(prompt);
  try {
    const parsed = JSON.parse(text);
    const picks = Array.isArray(parsed.picks) ? parsed.picks : [];
    return { picks, rationale: parsed.rationale || 'No rationale provided' } as DraftSuggestion;
  } catch {
    return { picks: [], rationale: 'Model returned non-JSON. Skipping.' };
  }
}

