/**
 * @fileoverview Utility functions for calculating FAAB (Free Agent Acquisition Budget) bids.
 */

/**
 * @interface FaabOptions
 * @description Options for calculating FAAB bids.
 * @property {number} totalBudget - The total FAAB budget for the season (e.g., 100).
 * @property {number} week - The current week number of the season (1-based).
 * @property {number} [endWeek=14] - The last week of the regular season to spend budget.
 */
export interface FaabOptions {
  totalBudget: number; // e.g., 100
  week: number; // current week number (1-based)
  endWeek?: number; // last week to spend (defaults 14)
}

/**
 * @interface ClaimLike
 * @description A generic interface representing the essential properties of a waiver claim.
 * @property {number} priority - The priority of the claim (lower is better).
 * @property {string} reasoning - The reasoning behind the claim.
 * @property {string} playerId - The ID of the player to add.
 * @property {string} [dropPlayerId] - The ID of the player to drop.
 */
export interface ClaimLike { priority: number; reasoning: string; playerId: string; dropPlayerId?: string; }

/**
 * @function attachBids
 * @description Attaches calculated FAAB bid amounts to a list of waiver claims based on priority and remaining budget.
 * This function uses a simple heuristic to spread the budget across the remaining weeks and apply a gradient based on claim priority.
 * @template T - A type that extends the `ClaimLike` interface.
 * @param {T[]} claims - An array of waiver claims.
 * @param {FaabOptions} opts - Options for calculating the bids.
 * @returns {Array<T & { bidAmount: number }>} A new array of claims, each with a `bidAmount` property.
 */
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

