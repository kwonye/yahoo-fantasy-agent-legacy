/**
 * @fileoverview Utility functions for roster management, specifically for handling
 * Injured Reserve (IR) and FLEX position assignments.
 */
import { LeagueSettings } from '../models/Team';
import { Player } from '../models/Player';

/**
 * @interface RosterEntry
 * @description Represents a player on a team's roster, including their assigned slot.
 * @property {string} [slot] - The roster slot the player is currently in (e.g., 'QB', 'RB', 'IR').
 * @property {Player} player - The player object.
 */
export interface RosterEntry { slot?: string; player: Player }

/**
 * @interface LineupAssignment
 * @description Represents a planned move of a player to a specific roster position.
 * @property {string} position - The target position for the player (e.g., 'IR', 'BN', 'FLEX').
 * @property {string} playerId - The ID of the player to be moved.
 */
export interface LineupAssignment { position: string; playerId: string }

const FLEX_SLOTS = new Set<string>(['FLEX', 'W/R/T', 'W/R', 'W/T']);

/**
 * @function computeIrAssignments
 * @description Analyzes a team's roster to determine optimal moves to and from the Injured Reserve (IR) slot.
 * It identifies players eligible to be moved to IR and players on IR who are no longer eligible and should be moved to the bench.
 * @param {RosterEntry[]} entries - The current roster entries with slot assignments.
 * @param {LeagueSettings} league - The settings for the league.
 * @returns {LineupAssignment[]} An array of lineup assignments for IR moves.
 */
export function computeIrAssignments(entries: RosterEntry[], league: LeagueSettings): LineupAssignment[] {
  const out: LineupAssignment[] = [];
  const rosterPos = (league && league.rosterPositions) ? league.rosterPositions : {} as any;
  const irSlots = (rosterPos['IR'] || rosterPos['IL'] || 0) as number;
  if (!irSlots) return out;

  const onIr = entries.filter((e) => (e.slot || '').toUpperCase() === 'IR');
  const nonIr = entries.filter((e) => (e.slot || '').toUpperCase() !== 'IR');

  // Eligible for IR (heuristic based on status)
  const eligible = nonIr.filter((e) => {
    const s = String(e.player.status || '').toUpperCase();
    return s === 'OUT' || s === 'INJURED' || s === 'IR' || s === 'PUP' || s === 'COVID' || s === 'NFI' || s === 'SUSP';
  });

  // Move eligible into IR until capacity is reached
  const freeIr = Math.max(0, irSlots - onIr.length);
  for (let i = 0; i < freeIr && i < eligible.length; i++) {
    const el = eligible[i]!;
    out.push({ position: 'IR', playerId: el.player.id });
  }

  // Move ineligible currently on IR back to bench (BN)
  const ineligibleOnIr = onIr.filter((e) => {
    const s = String(e.player.status || '').toUpperCase();
    return !(
      s === 'OUT' || s === 'INJURED' || s === 'IR' || s === 'PUP' || s === 'COVID' || s === 'NFI' || s === 'SUSP'
    );
  });
  for (const e of ineligibleOnIr) {
    out.push({ position: 'BN', playerId: e.player.id });
  }
  return out;
}

/**
 * @function computeFlexAssignments
 * @description Analyzes a team's starting lineup to determine the optimal player to place in the FLEX position.
 * The heuristic aims to place the starter with the latest-starting game into the FLEX spot,
 * which provides maximum flexibility for last-minute lineup changes.
 * @param {RosterEntry[]} entries - The current roster entries with slot assignments.
 * @param {LeagueSettings} league - The settings for the league.
 * @returns {LineupAssignment[]} An array containing a single lineup assignment for the FLEX position, or an empty array if no change is needed.
 */
export function computeFlexAssignments(entries: RosterEntry[], league: LeagueSettings): LineupAssignment[] {
  const out: LineupAssignment[] = [];
  const rp = (league && league.rosterPositions) ? league.rosterPositions : {} as any;
  const keys = Object.keys(rp || {});
  const hasFlex = keys.some((p) => FLEX_SLOTS.has(String(p).toUpperCase()));
  if (!hasFlex) return out;
  const flexSlotName = keys.find((p) => FLEX_SLOTS.has(String(p).toUpperCase())) || 'FLEX';

  const isFlexEligible = (p: Player) => ['WR', 'RB', 'TE'].includes(String(p.position));
  const getTime = (p: Player): number => {
    try { return new Date((p.matchup as any)?.gameTime).getTime() || 0; } catch { return 0; }
  };

  const currentFlex = entries.filter((e) => String(e.slot || '').toUpperCase() === flexSlotName.toUpperCase());
  const starters = entries.filter((e) => {
    const slot = String(e.slot || '').toUpperCase();
    if (!slot) return false;
    if (slot === 'BN' || slot === 'IR') return false;
    return true;
  });

  const candidates = starters
    .filter((e) => isFlexEligible(e.player))
    .sort((a, b) => getTime(a.player) - getTime(b.player));

  if (candidates.length === 0) return out;
  const latest = candidates[candidates.length - 1];
  if (latest && latest.player && latest.player.id) {
    const flexHasLatest = currentFlex.some((e) => e.player.id === latest.player.id);
    if (!flexHasLatest) {
      out.push({ position: flexSlotName, playerId: latest.player.id });
    }
  }
  return out;
}
