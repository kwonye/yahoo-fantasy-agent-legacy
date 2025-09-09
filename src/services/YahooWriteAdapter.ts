import fs from 'fs';
import path from 'path';
import { YahooApiService } from './YahooApiService';
import { Lineup } from '../models/Lineup';
import { Player } from '../models/Player';
import { WaiverDecision, TradeDecision } from '../models/Decision';

export interface YahooWriteAdapterOptions {
  dumpDir?: string; // defaults to logs/yahoo_write_payloads
}

export interface LineupAssignment {
  position: string;
  playerId: string;
}

export class YahooWriteAdapter {
  private readonly api: YahooApiService;
  private readonly dumpDir: string;

  constructor(api: YahooApiService, opts: YahooWriteAdapterOptions = {}) {
    this.api = api;
    this.dumpDir = opts.dumpDir ?? path.join(process.cwd(), 'logs', 'yahoo_write_payloads');
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
    if (process.env.YAHOO_XML_WRITE === '1') {
      const xml = this.buildLineupXML(assignments);
      this.dump('assignments.xml', xml);
      try {
        const res = await (this.api as any).updateRosterXml(teamKey, xml);
        return res;
      } catch {
        return { success: false };
      }
    }
    return { success: false };
  }

  async applyLineup(teamKey: string, target: Lineup): Promise<{ success: boolean }> {
    const assignments = this.planLineupAssignments([], target);
    this.dump('lineup', this.buildLineupPayload(assignments));
    // Yahoo supports writes via XML only. Require YAHOO_XML_WRITE=1.
    if (process.env.YAHOO_XML_WRITE === '1') {
      const xml = this.buildLineupXML(assignments);
      this.dump('lineup.xml', xml);
      try {
        const res = await (this.api as any).updateRosterXml(teamKey, xml);
        return res;
      } catch {
        return { success: false };
      }
    }
    return { success: false };
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

  async applyWaivers(leagueKey: string, decision: WaiverDecision): Promise<{ success: boolean }> {
    const payload = this.buildWaiverPayload(decision);
    this.dump('waivers', payload);
    if (process.env.YAHOO_XML_WRITE === '1') {
      const xml = this.buildWaiverXML(leagueKey, decision);
      this.dump('waivers.xml', xml);
      try {
        const res = await (this.api as any).submitTransactionsXml(leagueKey, xml);
        return { success: res.success };
      } catch {
        return { success: false };
      }
    }
    return { success: false };
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
    };
  }

  async applyTrade(leagueKey: string, decision: TradeDecision): Promise<{ success: boolean; id?: string }> {
    const payload = this.buildTradePayload(decision);
    this.dump('trade', payload);
    if (!decision.proposal) return { success: false };
    if (process.env.YAHOO_XML_WRITE === '1') {
      const xml = this.buildTradeXML(leagueKey, decision);
      this.dump('trade.xml', xml);
      try {
        const res = await (this.api as any).proposeTradeXml(leagueKey, xml);
        return res;
      } catch {
        return { success: false };
      }
    }
    return { success: false };
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
    if (process.env.YAHOO_XML_WRITE === '1') {
      const xml = this.buildTradeResponseXML(leagueKey, tradeId, accept);
      this.dump('trade_response.xml', xml);
      try {
        const res = await (this.api as any).submitTransactionsXml(leagueKey, xml);
        return { success: res.success };
      } catch {
        return { success: false };
      }
    }
    return { success: false };
  }

  private dump(prefix: string, data: any) {
    if (!process.env.DEBUG_YAHOO) return;
    try {
      if (!fs.existsSync(this.dumpDir)) fs.mkdirSync(this.dumpDir, { recursive: true });
      const file = path.join(this.dumpDir, `${Date.now()}_${prefix}.json`);
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    } catch {
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

  buildWaiverXML(leagueKey: string, decision: WaiverDecision): string {
    const items = decision.claims
      .map((c) => `
        <player>
          <transaction_data>
            <type>add</type>
            <league_key>${escapeXml(leagueKey)}</league_key>
            <destination_type>waivers</destination_type>
            ${c.bidAmount !== undefined ? `<faab_bid>${escapeXml(String(c.bidAmount))}</faab_bid>` : ''}
          </transaction_data>
          <player_id>${escapeXml(c.playerId)}</player_id>
        </player>
        ${c.dropPlayerId ? `<player><transaction_data><type>drop</type></transaction_data><player_id>${escapeXml(c.dropPlayerId)}</player_id></player>` : ''}
      `)
      .join('');
    return `<fantasy_content><transaction><type>add/drop</type><players>${items}</players></transaction></fantasy_content>`;
  }

  buildTradeXML(leagueKey: string, decision: TradeDecision): string {
    if (!decision.proposal) return '<fantasy_content />';
    const mine = (decision.proposal.myPlayers || []).map((p) => `<player_id>${escapeXml(p)}</player_id>`).join('');
    const theirs = (decision.proposal.theirPlayers || []).map((p) => `<player_id>${escapeXml(p)}</player_id>`).join('');
    return `<fantasy_content><trade>
      <league_key>${escapeXml(leagueKey)}</league_key>
      <proposed_trade>
        <to_other_team>${escapeXml(decision.proposal.targetTeamId)}</to_other_team>
        <my_players>${mine}</my_players>
        <their_players>${theirs}</their_players>
      </proposed_trade>
    </trade></fantasy_content>`;
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
