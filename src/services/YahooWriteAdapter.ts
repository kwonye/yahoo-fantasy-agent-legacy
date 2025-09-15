import fs from 'fs';
import path from 'path';
import { YahooApiService } from './YahooApiService';
import { Lineup } from '../models/Lineup';
import { Player } from '../models/Player';
import { WaiverDecision, TradeDecision } from '../models/Decision';

export interface YahooWriteAdapterOptions {
  dumpDir?: string; // defaults to logs/yahoo_write_payloads
  debugYahoo?: boolean; // Added this
}

export interface LineupAssignment {
  position: string;
  playerId: string;
}

export class YahooWriteAdapter {
  private readonly api: YahooApiService;
  private readonly dumpDir: string;
  private readonly debugYahoo: boolean; // Dashboard-controlled

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

  planLineupAssignments(_roster: Player[], target: Lineup): LineupAssignment[] {
    const assignments: LineupAssignment[] = [];
    for (const [position, player] of Object.entries(target.starters)) {
      if (player && player.id) {
        assignments.push({ position, playerId: player.id });
      }
    }
    return assignments;
  }

  buildLineupPayload(assignments: LineupAssignment[]) {
    // Yahoo typically expects per-player position changes; shape for debugging only
    return {
      type: 'lineup_update',
      assignments,
    };
  }

  async applyAssignments(teamKey: string, assignments: LineupAssignment[]): Promise<{ success: boolean }> {
    this.dump('assignments', this.buildLineupPayload(assignments));
    const xml = this.buildLineupXML(assignments);
    this.dump('assignments.xml', xml);
    try {
      const res = await (this.api as any).updateRosterXml(teamKey, xml);
      return res;
    } catch {
      return { success: false };
    }
  }

  async applyLineup(teamKey: string, target: Lineup): Promise<{ success: boolean }> {
    const assignments = this.planLineupAssignments([], target);
    this.dump('lineup', this.buildLineupPayload(assignments));
    // Yahoo supports writes via XML only.
    const xml = this.buildLineupXML(assignments);
    this.dump('lineup.xml', xml);
    try {
      const res = await (this.api as any).updateRosterXml(teamKey, xml);
      return res;
    } catch {
      return { success: false };
    }
  }

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

  buildPickupPayload(decision: WaiverDecision) {
    return {
      type: 'immediate_pickups',
      moves: decision.claims.map((c) => ({ add: c.playerId, drop: c.dropPlayerId, reasoning: c.reasoning })),
    };
  }

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

  async applyPickups(leagueKey: string, myTeamKey: string, decision: WaiverDecision): Promise<{ success: boolean }> {
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
    const payload = this.buildPickupPayload(decision);
    this.dump('pickups', payload);
    const xml = this.buildPickupXML(leagueKey, myTeamKey, decision);
    this.dump('pickups.xml', xml);
    try {
      const res = await (this.api as any).submitTransactionsXml(leagueKey, xml);
      return { success: res.success };
    } catch {
      return { success: false };
    }
  }

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

  // Backward-compatible signature: allow applyTrade(leagueKey, decision) for tests/helpers
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

  buildTradeResponseXML(leagueKey: string, tradeId: string, accept: boolean): string {
    const action = accept ? 'accept' : 'reject';
    return `<fantasy_content><transaction>
      <type>trade</type>
      <league_key>${escapeXml(leagueKey)}</league_key>
      <transaction_key>${escapeXml(tradeId)}</transaction_key>
      <action>${escapeXml(action)}</action>
    </transaction></fantasy_content>`;
  }

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

  // ---------------- XML builders (best-effort payloads for iteration) ----------------
  buildLineupXML(assignments: LineupAssignment[]): string {
    const items = assignments
      .map((a) => `<assignment><position>${escapeXml(a.position)}</position><player_id>${escapeXml(a.playerId)}</player_id></assignment>`) 
      .join('');
    return `<fantasy_content><roster><assignments>${items}</assignments></roster></fantasy_content>`;
  }

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
    return `<?xml version='1.0' encoding='UTF-8'?><fantasy_content><transactions><transaction><type>add</type><players>${items}</players></transaction></transactions></fantasy_content>`;
  }

  buildPickupXML(leagueKey: string, myTeamKey: string, decision: WaiverDecision): string {
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
        return `
        <player>
          <player_key>${escapeXml(addKey)}</player_key>
          <transaction_data>
            <type>add</type>
            <destination_team_key>${escapeXml(myTeamKey)}</destination_team_key>
          </transaction_data>
        </player>
        ${dropKey ? `<player><player_key>${escapeXml(dropKey)}</player_key><transaction_data><type>drop</type><source_team_key>${escapeXml(myTeamKey)}</source_team_key></transaction_data></player>` : ''}`;
      })
      .join('');
    return `<?xml version='1.0' encoding='UTF-8'?><fantasy_content><transactions><transaction><type>add/drop</type><players>${items}</players></transaction></transactions></fantasy_content>`;
  }

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
