import type { Player } from '../models/Player';

export interface RosterNeedsSurplus {
  needs: string[];
  surplus: string[];
  counts: Record<string, number>;
}

export function computeNeedsAndSurplus(
  roster: Player[] | any[],
  rosterPositions: Record<string, number | string | undefined>
): RosterNeedsSurplus {
  const counts: Record<string, number> = {};
  for (const entry of roster || []) {
    const positionRaw = String((entry?.position ?? entry?.display_position ?? '') || '').toUpperCase();
    const positions = positionRaw.split(/[ ,/]+/).filter(Boolean);
    if (positions.length === 0) positions.push('BN');
    for (const pos of positions) {
      counts[pos] = (counts[pos] ?? 0) + 1;
    }
  }

  const needs: string[] = [];
  const surplus: string[] = [];
  for (const [slot, requiredRaw] of Object.entries(rosterPositions || {})) {
    const slotKey = String(slot || '').toUpperCase();
    if (slotKey === 'BN' || slotKey === 'IR') continue;
    const required = Number.isFinite(Number(requiredRaw)) ? Number(requiredRaw) : 0;
    if (required <= 0) continue;
    const available = counts[slotKey] ?? 0;
    if (available < required) needs.push(slotKey);
    if (available > required) surplus.push(slotKey);
  }

  return { needs, surplus, counts };
}
