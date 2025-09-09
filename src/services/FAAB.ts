export interface FaabOptions {
  totalBudget: number; // e.g., 100
  week: number; // current week number (1-based)
  endWeek?: number; // last week to spend (defaults 14)
}

export interface ClaimLike { priority: number; reasoning: string; playerId: string; dropPlayerId?: string; }

export function attachBids<T extends ClaimLike>(claims: T[], opts: FaabOptions): Array<T & { bidAmount: number }>{
  const endWeek = opts.endWeek ?? 14;
  const weeksLeft = Math.max(1, endWeek - opts.week + 1);
  const basePerWeek = Math.max(1, Math.floor(opts.totalBudget / weeksLeft));

  // Normalize priorities (1 highest). Distribute budget with small gradient.
  const sorted = claims.slice().sort((a, b) => a.priority - b.priority);
  const result: Array<T & { bidAmount: number }> = [];
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const factor = Math.max(0, (sorted.length - i)); // higher for better priority
    const bid = Math.max(0, Math.floor(basePerWeek + (factor - 1))); // simple gradient
    result.push({ ...(c as any), bidAmount: bid });
  }
  return result;
}

