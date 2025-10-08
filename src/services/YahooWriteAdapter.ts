/**
 * @fileoverview This file contains the YahooWriteAdapter class, which is responsible
 * for translating abstract bot decisions into concrete XML payloads for the Yahoo Fantasy API.
 */
import fs from 'fs';
import path from 'path';
import { YahooApiService } from './YahooApiService';
import { Lineup } from '../models/Lineup';
import { Player } from '../models/Player';
import { WaiverDecision, TradeDecision } from '../models/Decision';

/**
 * @interface YahooWriteAdapterOptions
 * @description Options for configuring the YahooWriteAdapter.
 * @property {string} [dumpDir] - The directory to dump write payloads for debugging purposes.
 * @property {boolean} [debugYahoo] - A flag to enable or disable debug dumping.
 */
export interface YahooWriteAdapterOptions {
  dumpDir?: string; // defaults to logs/yahoo_write_payloads
  debugYahoo?: boolean; // Added this
}

/**
 * @interface LineupAssignment
 * @description Represents the assignment of a player to a specific lineup position.
 * @property {string} position - The target position (e.g., 'QB', 'RB', 'BN', 'IR').
 * @property {string} playerId - The unique identifier of the player.
 */
export interface LineupAssignment {
  position: string;
  playerId: string;
}

/**
 * @class YahooWriteAdapter
 * @description This class acts as an adapter to format and send write requests (lineup changes, waiver claims, trades)
 * to the Yahoo Fantasy API. It translates abstract decisions into the required XML format.
 */
export class YahooWriteAdapter {
  private readonly api: YahooApiService;
  private readonly dumpDir: string;
  private readonly debugYahoo: boolean; // Dashboard-controlled

  /**
   * @constructor
   * @param {YahooApiService} api - An instance of the YahooApiService for making API calls.
   * @param {YahooWriteAdapterOptions} [opts={}] - Configuration options for the adapter.
   */
  constructor(api: YahooApiService, opts: YahooWriteAdapterOptions = {}) {
    this.api = api;
    this.dumpDir = opts.dumpDir ?? path.join(process.cwd(), 'logs', 'yahoo_write_payloads');
    try {
      const { ConfigManager } = require('./ConfigManager');
      const cm = new ConfigManager();
      const app = cm.loadAppSettings();
      this.debugYahoo = opts.debugYahoo ?? !!app.debugYahooEnabled;
    } catch {
      this.debugYahoo = !!opts.debugYahoo;
    }
  }

  /**
   * @method planLineupAssignments
   * @description Translates a target lineup object into a list of specific player-to-position assignments.
   * @param {Player[]} _roster - The current roster (currently unused in this implementation).
   * @param {Lineup} target - The target lineup to generate assignments for.
   * @returns {LineupAssignment[]} An array of lineup assignments.
   */
  planLineupAssignments(_roster: Player[], target: Lineup): LineupAssignment[] {
    const assignments: LineupAssignment[] = [];
    for (const [position, player] of Object.entries(target.starters || {})) {
      if (player && player.id) {
        const pid = String(player.id);
        assignments.push({ position, playerId: pid });
      }
    }
    for (const player of target.bench || []) {
      if (player && player.id) {
        const pid = String(player.id);
        assignments.push({ position: 'BN', playerId: pid });
      }
    }
    return assignments;
  }

  /**
   * @method buildLineupPayload
   * @description Builds a JSON payload for a lineup update, primarily for debugging and logging.
   * @param {LineupAssignment[]} assignments - The list of lineup assignments.
   * @returns {{ type: string; assignments: LineupAssignment[] }} A structured payload object.
   */
  buildLineupPayload(assignments: LineupAssignment[]) {
    // Yahoo typically expects per-player position changes; shape for debugging only
    return {
      type: 'lineup_update',
      assignments,
    };
  }

  /**
   * @method applyAssignments
   * @description Applies a set of lineup assignments to a team's roster.
   * @param {string} teamKey - The key of the team to update.
   * @param {LineupAssignment[]} assignments - The assignments to apply.
   * @returns {Promise<{ success: boolean }>} An object indicating whether the operation was successful.
   */
  async applyAssignments(teamKey: string, assignments: LineupAssignment[]): Promise<{ success: boolean }> {
    this.dump('assignments', this.buildLineupPayload(assignments));
    try {
      const apiAny = this.api as any;
      if (typeof apiAny.updateRosterAssignments === 'function') {
        const res = await apiAny.updateRosterAssignments(teamKey, assignments);
        if (res?.xml) this.dump('assignments.xml', res.xml);
        return { success: !!res?.success };
      }
      const xml = this.buildLineupXML(teamKey, assignments);
      this.dump('assignments.xml', xml);
      const res = await apiAny.updateRosterXml(teamKey, xml);
      return res;
    } catch (e) {
      console.error('Error applying roster assignments:', e);
      return { success: false };
    }
  }

  /**
   * @method applyLineup
   * @description A convenience method to apply a full lineup to a team's roster.
   * @param {string} teamKey - The key of the team to update.
   * @param {Lineup} target - The target lineup.
   * @returns {Promise<{ success: boolean }>} An object indicating whether the operation was successful.
   */
  async applyLineup(teamKey: string, target: Lineup): Promise<{ success: boolean }> {
    const assignments = this.planLineupAssignments([], target);
    this.dump('lineup', this.buildLineupPayload(assignments));
    try {
      const res = await this.applyAssignments(teamKey, assignments);
      return res;
    } catch (e) {
      console.error('Error applying lineup:', e);
      return { success: false };
    }
  }

  /**
   * @method buildWaiverPayload
   * @description Builds a JSON payload for waiver claims, for debugging.
   * @param {WaiverDecision} decision - The waiver decision object.
   * @returns {object} A structured payload object.
   */
  buildWaiverPayload(decision: WaiverDecision) {
    return {
      type: 'waiver_claims',
      claims: decision.claims.map((c) => ({
        add: c.playerId,
        drop: c.dropPlayerId,
        priority: c.priority,
        reasoning: c.reasoning,
        bidAmount: c.bidAmount,
      })),
    };
  }

  /**
   * @method buildPickupPayload
   * @description Builds a JSON payload for immediate pickups, for debugging.
   * @param {WaiverDecision} decision - The pickup decision object.
   * @returns {object} A structured payload object.
   */
  buildPickupPayload(decision: WaiverDecision) {
    return {
      type: 'immediate_pickups',
      moves: decision.claims.map((c) => ({ add: c.playerId, drop: c.dropPlayerId, reasoning: c.reasoning })),
    };
  }

  /**
   * @method applyWaivers
   * @description Submits waiver claims to the Yahoo API.
   * @param {string} leagueKey - The key of the league.
   * @param {string} myTeamKey - The key of the team submitting the claims.
   * @param {WaiverDecision} decision - The waiver decision containing the claims.
   * @returns {Promise<{ success: boolean }>} An object indicating whether the operation was successful.
   */
  async applyWaivers(leagueKey: string, myTeamKey: string, decision: WaiverDecision): Promise<{ success: boolean }> {
    const payload = this.buildWaiverPayload(decision);
    this.dump('waivers', payload);
    const xml = this.buildWaiverXML(leagueKey, myTeamKey, decision);
    this.dump('waivers.xml', xml);
    try {
      const res = await (this.api as any).submitTransactionsXml(leagueKey, xml);
      return { success: res.success };
    } catch {
      return { success: false };
    }
  }

  /**
   * @method applyPickups
   * @description Submits immediate free agent pickups to the Yahoo API.
   * @param {string} leagueKey - The key of the league.
   * @param {string} myTeamKey - The key of the team submitting the pickups.
   * @param {WaiverDecision} decision - The pickup decision containing the add/drop moves.
   * @returns {Promise<{ success: boolean; error?: string }>} An object indicating success or failure, with an optional error message.
   */
  async applyPickups(
    leagueKey: string,
    myTeamKey: string,
    decision: WaiverDecision
  ): Promise<{ success: boolean; error?: string }> {
    // Ensure drop ids exist where needed by deriving from current roster as a fallback
    try {
      const entries: Array<{ slot?: string; player: any }> = await (this.api as any).getTeamRosterWithSlots(myTeamKey);
      const rosterIds = entries.map((e) => String(e.player.id));
      const addSet = new Set((decision.claims || []).map((c) => String(c.playerId)));
      const dropCandidates = rosterIds.filter((id) => !addSet.has(String(id))).reverse();
      const fallbackId = rosterIds[0];
      let idx = 0;
      decision.claims = (decision.claims || []).map((c) => ({
        ...c,
        dropPlayerId: c.dropPlayerId || dropCandidates[idx++] || fallbackId || c.dropPlayerId,
      }));
    } catch {}

    try { console.log('[Pickups] Final claims before XML:', JSON.stringify(decision.claims)); } catch {}

    try {
      await this.ensurePickupEligibility(leagueKey, myTeamKey, decision.claims || []);
    } catch (eligErr) {
      const message = (eligErr as Error).message;
      console.warn('[Pickups] Blocked by eligibility guard:', message);
      return { success: false, error: message };
    }

    const payload = this.buildPickupPayload(decision);
    this.dump('pickups', payload);

    const apiAny = this.api as any;
    const submit = apiAny.submitTransactionsXml.bind(apiAny);

    for (const claim of decision.claims || []) {
      const singleDecision: WaiverDecision = { ...decision, claims: [claim] };
      const xml = this.buildPickupXML(leagueKey, myTeamKey, singleDecision);
      this.dump('pickups.xml', xml);
      try {
        const res = await submit(leagueKey, xml);
        if (!res?.success) return { success: false, error: 'apply_failed' };
      } catch (e) {
        console.error('Error submitting pickups XML:', e);
        return { success: false, error: (e as Error).message };
      }
    }

    return { success: true };
  }

  /**
   * @method buildTradePayload
   * @description Builds a JSON payload for a trade proposal, for debugging.
   * @param {TradeDecision} decision - The trade decision object.
   * @returns {object} A structured payload object.
   */
  buildTradePayload(decision: TradeDecision) {
    return {
      type: 'trade_proposal',
      shouldTrade: decision.shouldTrade,
      proposal: decision.proposal && {
        from_me: decision.proposal.myPlayers,
        from_them: decision.proposal.theirPlayers,
        targetTeamId: decision.proposal.targetTeamId,
        reasoning: decision.proposal.reasoning,
      },
      proposals: Array.isArray(decision.proposals) ? decision.proposals.map(p => ({
        from_me: p.myPlayers,
        from_them: p.theirPlayers,
        targetTeamId: p.targetTeamId,
        reasoning: p.reasoning,
      })) : undefined,
    };
  }

  /**
   * @method applyTrade
   * @description Proposes a trade to another team in the league.
   * @param {string} leagueKey - The key of the league.
   * @param {string | TradeDecision} myTeamKeyOrDecision - The team key of the proposer, or the trade decision object itself.
   * @param {TradeDecision} [maybeDecision] - The trade decision object if the team key was provided as the second argument.
   * @returns {Promise<{ success: boolean; id?: string }>} An object indicating success and the new transaction ID.
   */
  async applyTrade(leagueKey: string, myTeamKeyOrDecision: string | TradeDecision, maybeDecision?: TradeDecision): Promise<{ success: boolean; id?: string }> {
    const myTeamKey = typeof myTeamKeyOrDecision === 'string' ? myTeamKeyOrDecision : '';
    const decision: TradeDecision = typeof myTeamKeyOrDecision === 'string' ? (maybeDecision as TradeDecision) : (myTeamKeyOrDecision as TradeDecision);
    const payload = this.buildTradePayload(decision);
    this.dump('trade', payload);
    if (!decision?.proposal) return { success: false };
    if (!myTeamKey) return { success: false }; // cannot build a valid trade without source team key
    const xml = this.buildTradeXML(leagueKey, myTeamKey, decision);
    this.dump('trade.xml', xml);
    try {
      const res = await (this.api as any).proposeTradeXml(leagueKey, xml);
      return res;
    } catch (e) {
      console.error('Error proposing trade:', e);
      return { success: false };
    }
  }

  /**
   * @method buildTradeResponseXML
   * @description Builds the XML payload for responding to a trade offer.
   * @param {string} leagueKey - The key of the league.
   * @param {string} tradeId - The ID of the trade to respond to.
   * @param {boolean} accept - Whether to accept or reject the trade.
   * @returns {string} The XML payload string.
   */
  buildTradeResponseXML(leagueKey: string, tradeId: string, accept: boolean): string {
    const action = accept ? 'accept' : 'reject';
    return `<fantasy_content><transaction>
      <type>trade</type>
      <league_key>${escapeXml(leagueKey)}</league_key>
      <transaction_key>${escapeXml(tradeId)}</transaction_key>
      <action>${escapeXml(action)}</action>
    </transaction></fantasy_content>`;
  }

  /**
   * @method applyTradeResponse
   * @description Submits a response (accept/reject) to an incoming trade offer.
   * @param {string} leagueKey - The key of the league.
   * @param {string} tradeId - The ID of the trade to respond to.
   * @param {boolean} accept - `true` to accept the trade, `false` to reject.
   * @returns {Promise<{ success: boolean }>} An object indicating whether the operation was successful.
   */
  async applyTradeResponse(leagueKey: string, tradeId: string, accept: boolean): Promise<{ success: boolean }>{
    const xml = this.buildTradeResponseXML(leagueKey, tradeId, accept);
    this.dump('trade_response.xml', xml);
    try {
      const res = await (this.api as any).submitTransactionsXml(leagueKey, xml);
      return { success: res.success };
    } catch {
      return { success: false };
    }
  }

  private dump(prefix: string, data: any) {
    console.log(`--- Entering dump function for prefix: ${prefix} ---`);
    if (!this.debugYahoo) return;
    try {
      console.log(`Dump directory: ${this.dumpDir}`);
      console.log(`Checking if dump directory exists: ${this.dumpDir}`); // Added this
      const dirExists = fs.existsSync(this.dumpDir);
      console.log(`Dump directory exists: ${dirExists}`);
      if (!dirExists) {
        console.log(`Attempting to create dump directory: ${this.dumpDir}`);
        fs.mkdirSync(this.dumpDir, { recursive: true });
        console.log('Dump directory created.');
      }
      const file = path.join(this.dumpDir, `${Date.now()}_${prefix}.json`);
      console.log(`Attempting to write to file: ${file}`); // Added this
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
      console.log('Dump successful.');
    } catch (e) {
      console.error('Error during dump:', e);
      // ignore
    }
  }

  /**
   * @private
   * @method buildLineupXML
   * @description Builds the XML payload for updating a team's lineup.
   * @param {string} teamKey - The key of the team.
   * @param {LineupAssignment[]} assignments - The lineup assignments.
   * @param {number} [week] - The week to apply the lineup for.
   * @returns {string} The XML payload.
   */
  buildLineupXML(teamKey: string, assignments: LineupAssignment[], week?: number): string {
    const gameKey = (() => {
      const idx = teamKey.indexOf('.l.');
      return idx > 0 ? teamKey.slice(0, idx) : undefined;
    })();
    const normalize = (pid: string) => {
      const trimmed = String(pid).trim();
      if (/^\d+\.p\.\d+/i.test(trimmed) || trimmed.includes('.p.')) return trimmed;
      if (trimmed && /^\d+$/.test(trimmed) && gameKey) return `${gameKey}.p.${trimmed}`;
      return trimmed;
    };
    const escape = (value: string): string =>
      String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    const players = assignments
      .map((a) => `<player><player_key>${escape(normalize(a.playerId))}</player_key><position>${escape(String(a.position || 'BN').toUpperCase())}</position></player>`)
      .join('');
    const weekXml = week !== undefined ? `<week>${escape(String(week))}</week>` : '';
    return `<?xml version='1.0' encoding='UTF-8'?><fantasy_content><roster><coverage_type>week</coverage_type>${weekXml}<players>${players}</players></roster></fantasy_content>`;
  }

  /**
   * @private
   * @method buildWaiverXML
   * @description Builds the XML payload for submitting waiver claims.
   * @param {string} leagueKey - The key of the league.
   * @param {string} myTeamKey - The key of the team making the claims.
   * @param {WaiverDecision} decision - The waiver decision object.
   * @returns {string} The XML payload.
   */
  buildWaiverXML(leagueKey: string, myTeamKey: string, decision: WaiverDecision): string {
    const gameKey = leagueKey.split('.l.')[0];
    const normalizePlayerKey = (pid: string): string => {
      const s = String(pid);
      if (/^\d+\.p\.\d+$/.test(s) || s.includes('.p.')) return s;
      if (/^\d+$/.test(s)) return `${gameKey}.p.${s}`;
      return s;
    };
    const items = decision.claims
      .map((c) => {
        const addKey = normalizePlayerKey(c.playerId);
        const dropKey = c.dropPlayerId ? normalizePlayerKey(c.dropPlayerId) : undefined;
        const bid = c.bidAmount !== undefined ? String(c.bidAmount) : '0';
        return `
        <player>
          <player_key>${escapeXml(addKey)}</player_key>
          <transaction_data>
            <type>add</type>
            <destination_team_key>${escapeXml(myTeamKey)}</destination_team_key>
            <faab_bid>${escapeXml(bid)}</faab_bid>
          </transaction_data>
        </player>
        ${dropKey ? `<player><player_key>${escapeXml(dropKey)}</player_key><transaction_data><type>drop</type><source_team_key>${escapeXml(myTeamKey)}</source_team_key></transaction_data></player>` : ''}`;
      })
      .join('');
    const ns = " xmlns=\"http://fantasysports.yahooapis.com/fantasy/v2/base.rng\"";
    return `<?xml version="1.0" encoding="UTF-8"?><fantasy_content${ns}><transaction><type>add</type><players>${items}</players></transaction></fantasy_content>`;
  }

  /**
   * @private
   * @method buildPickupXML
   * @description Builds the XML payload for immediate free agent pickups.
   * @param {string} leagueKey - The key of the league.
   * @param {string} myTeamKey - The key of the team making the pickups.
   * @param {WaiverDecision} decision - The pickup decision object.
   * @returns {string} The XML payload.
   */
  buildPickupXML(leagueKey: string, myTeamKey: string, decision: WaiverDecision): string {
    const gameKey = leagueKey.split('.l.')[0];
    const normalizePlayerKey = (pid: string): string => {
      const s = String(pid);
      if (/^\d+\.p\.\d+$/.test(s) || s.includes('.p.')) return s;
      if (/^\d+$/.test(s)) return `${gameKey}.p.${s}`;
      return s;
    };
    const players = (decision.claims || [])
      .map((claim) => {
        const addKey = normalizePlayerKey(claim.playerId);
        const dropKey = claim.dropPlayerId ? normalizePlayerKey(claim.dropPlayerId) : undefined;
        const addNode = `
        <player>
          <player_key>${escapeXml(addKey)}</player_key>
          <transaction_data>
            <type>add</type>
            <destination_team_key>${escapeXml(myTeamKey)}</destination_team_key>
          </transaction_data>
        </player>`;
        const dropNode = dropKey
          ? `
        <player>
          <player_key>${escapeXml(dropKey)}</player_key>
          <transaction_data>
            <type>drop</type>
            <source_team_key>${escapeXml(myTeamKey)}</source_team_key>
          </transaction_data>
        </player>`
          : '';
        return `${addNode}${dropNode}`;
      })
      .join('');
    const type = (decision.claims || []).some((c) => c.dropPlayerId) ? 'add/drop' : 'add';
    return `<fantasy_content><transaction><type>${type}</type><players>${players}
        </players></transaction></fantasy_content>`;
  }

  private async ensurePickupEligibility(leagueKey: string, myTeamKey: string, claims: WaiverDecision['claims']): Promise<void> {
    if (!Array.isArray(claims) || claims.length === 0) return;
    const apiAny = this.api as any;
    if (typeof apiAny.getRecentDropsToWaivers !== 'function') return;
    const cooldownMs = this.computeWaiverCooldownMs(leagueKey);
    if (!(cooldownMs > 0)) return;
    const cutoff = Date.now() - cooldownMs;
    let drops: Array<{ playerId: string; playerKey?: string; playerName?: string; droppedAt: number }> = [];
    try {
      drops = await apiAny.getRecentDropsToWaivers(myTeamKey, leagueKey, cutoff);
    } catch (err) {
      console.warn('[Pickups] Failed to query recent drops:', (err as Error).message);
      return;
    }
    if (!Array.isArray(drops) || drops.length === 0) return;
    const dropMap = new Map<string, { droppedAt: number; playerName?: string }>();
    for (const drop of drops) {
      if (!drop || !drop.playerId) continue;
      const id = this.normalizePlayerId(drop.playerId);
      if (!id) continue;
      const existing = dropMap.get(id);
      if (!existing || drop.droppedAt > existing.droppedAt) {
        dropMap.set(id, { droppedAt: drop.droppedAt, playerName: drop.playerName });
      }
    }
    if (dropMap.size === 0) return;
    const blocked: Array<{ claim: any; droppedAt: number; playerName?: string }> = [];
    for (const claim of claims) {
      if (!claim || !claim.playerId) continue;
      const id = this.normalizePlayerId(claim.playerId);
      if (!id) continue;
      const info = dropMap.get(id);
      if (info) blocked.push({ claim, droppedAt: info.droppedAt, playerName: info.playerName });
    }
    if (blocked.length === 0) return;
    const reasons = blocked.map(({ claim, droppedAt, playerName }) => {
      const display = playerName || String(claim.playerId);
      const elapsed = Date.now() - droppedAt;
      const waitRemaining = droppedAt + cooldownMs - Date.now();
      const sinceText = elapsed > 0 ? `${this.formatDuration(elapsed)} ago` : 'moments ago';
      const remainingText = waitRemaining > 0 ? ` (~${this.formatDuration(waitRemaining)} remaining)` : '';
      return `${display} (dropped ${sinceText}${remainingText})`;
    });
    throw new Error(`Cannot add players still in your waiver cooldown: ${reasons.join('; ')}.`);
  }

  private computeWaiverCooldownMs(leagueKey: string): number {
    const envOverride = process.env.WAIVER_READD_COOLDOWN_HOURS;
    if (envOverride) {
      const hours = Number.parseFloat(envOverride);
      if (Number.isFinite(hours) && hours >= 0) return hours * 60 * 60 * 1000;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ConfigManager } = require('./ConfigManager');
      const cm = new ConfigManager();
      const profile = cm.loadLeagueProfile(leagueKey);
      const meta: any = profile?.meta ?? {};
      const raw = String(meta.waiverTime || meta.waiver_time || '').trim();
      if (raw) {
        const valueMatch = raw.match(/(\d+(?:\.\d+)?)/);
        if (valueMatch && valueMatch[1]) {
          const value = Number.parseFloat(valueMatch[1]);
          if (Number.isFinite(value) && value >= 0) {
            if (/hour/i.test(raw)) return value * 60 * 60 * 1000;
            if (/day/i.test(raw)) return value * 24 * 60 * 60 * 1000;
          }
        }
        if (/no waivers?/i.test(raw)) return 0;
      }
    } catch (err) {
      console.warn('[Pickups] Unable to determine waiver cooldown from league profile:', (err as Error).message);
    }
    // Default safeguard: 48 hours
    return 48 * 60 * 60 * 1000;
  }

  private normalizePlayerId(id: string): string | null {
    const str = String(id || '').trim();
    if (!str) return null;
    const match = str.match(/(\d+)$/);
    return match && match[1] ? match[1] : str;
  }

  private formatDuration(ms: number): string {
    const abs = Math.abs(ms);
    const minutes = Math.round(abs / 60000);
    if (minutes < 1) return '<1 min';
    if (minutes < 90) return `${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} hr${hours === 1 ? '' : 's'}`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'}`;
  }

  /**
   * @private
   * @method buildTradeXML
   * @description Builds the XML payload for proposing a trade.
   * @param {string} leagueKey - The key of the league.
   * @param {string} myTeamKey - The key of the team proposing the trade.
   * @param {TradeDecision} decision - The trade decision object.
   * @returns {string} The XML payload.
   */
  buildTradeXML(leagueKey: string, myTeamKey: string, decision: TradeDecision): string {
    if (!decision.proposal) return '<fantasy_content />';

    const traderTeamKey = myTeamKey;
    const tradeeTeamKey = decision.proposal.targetTeamId;
    const tradeNote = decision.proposal.reasoning || ''; // Use reasoning as trade note

    let playersXml = '';

    const gameKey = leagueKey.split('.l.')[0];
    const normalizePlayerKey = (pid: string): string => {
      const s = String(pid);
      // If already a full player_key like "406.p.12345", use as-is
      if (/^\d+\.p\.\d+$/.test(s) || s.includes('.p.')) return s;
      // If numeric id, build player_key with game key
      if (/^\d+$/.test(s)) return `${gameKey}.p.${s}`;
      // Last resort, return as-is (Yahoo may reject if malformed)
      return s;
    };

    // Players I am sending
    for (const playerId of decision.proposal.myPlayers) {
      const pkey = normalizePlayerKey(playerId);
      playersXml += `
        <player>
          <player_key>${escapeXml(pkey)}</player_key>
          <transaction_data>
            <type>pending_trade</type>
            <source_team_key>${escapeXml(traderTeamKey)}</source_team_key>
            <destination_team_key>${escapeXml(tradeeTeamKey)}</destination_team_key>
          </transaction_data>
        </player>`;
    }

    // Players I am receiving
    for (const playerId of decision.proposal.theirPlayers) {
      const pkey = normalizePlayerKey(playerId);
      playersXml += `
        <player>
          <player_key>${escapeXml(pkey)}</player_key>
          <transaction_data>
            <type>pending_trade</type>
            <source_team_key>${escapeXml(tradeeTeamKey)}</source_team_key>
            <destination_team_key>${escapeXml(traderTeamKey)}</destination_team_key>
          </transaction_data>
        </player>`;
    }

    return `<?xml version='1.0' encoding='UTF-8'?>
<fantasy_content>
  <transaction>
    <type>pending_trade</type>
    <trader_team_key>${escapeXml(traderTeamKey)}</trader_team_key>
    <tradee_team_key>${escapeXml(tradeeTeamKey)}</tradee_team_key>
    <trade_note>${escapeXml(tradeNote)}</trade_note>
    <players>${playersXml}
    </players>
  </transaction>
</fantasy_content>`;
  }
}

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
