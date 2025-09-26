import { ConfigManager } from '../services/ConfigManager';
import { YahooOAuthClient } from '../services/YahooOAuthClient';
import { YahooApiService } from '../services/YahooApiService';
import { GeminiClient } from '../services/GeminiClient';
import { GeminiQuota } from '../services/GeminiQuota';
import { DecisionService } from '../services/DecisionService';
import { Logger } from '../services/Logger';
import { AuditTrail } from '../services/AuditTrail';
import { Metrics } from '../services/Metrics';
import { BotDecision } from '../models/Decision';
import { DecisionType } from '../models/Common';
import { YahooWriteAdapter } from '../services/YahooWriteAdapter';
import { computeIrAssignments, computeFlexAssignments } from '../services/RosterHygiene';

export interface BotControllerOptions {
  leagueKey: string;
  teamKey: string;
}

export class BotController {
  private readonly yahoo: YahooApiService;
  private readonly decisions: DecisionService | null;
  private readonly logger: Logger;
  private readonly audit: AuditTrail;
  private readonly metrics: Metrics;
  private readonly leagueKey: string;
  private readonly teamKey: string;
  private readonly write: YahooWriteAdapter;
  private readonly quota: GeminiQuota;

  constructor(opts: BotControllerOptions) {
    const cfgMgr = new ConfigManager();
    const oauth = new YahooOAuthClient(cfgMgr);
    this.yahoo = new YahooApiService(oauth);
    this.write = new YahooWriteAdapter(this.yahoo, { debugYahoo: process.env.DEBUG_YAHOO === '1' });
    this.logger = new Logger({ service: 'bot' });
    this.audit = new AuditTrail();
    this.metrics = new Metrics();
    
    // Initialize Gemini if available; skip otherwise to avoid unnecessary prompt calls
    let decisions: DecisionService | null = null;
    try {
      const cm = new ConfigManager();
      const g = cm.loadGeminiCredentials();
      if (g && g.apiKey) {
        const gemini = new GeminiClient();
        decisions = new DecisionService(gemini);
      } else {
        this.logger.warn('Gemini API key missing (save it in the dashboard); skipping AI decisions');
      }
    } catch (e) {
      this.logger.warn('Gemini initialization failed; skipping AI decisions', { error: (e as Error).message });
    }
    this.decisions = decisions;
    this.leagueKey = opts.leagueKey;
    this.teamKey = opts.teamKey;
    this.quota = new GeminiQuota();
  }

  async runDaily(): Promise<void> {
    this.audit.recordAction('daily_start');
    await this.metrics.time('dailyRun', async () => {
      const cfgMgr0 = new ConfigManager();
      const app = cfgMgr0.loadAppSettings();
      await this.runRosterHygiene();
      // Game-day awareness: on Thu/Sun/Mon, rely on kickoff checks for lineup to save budget
      const dow = new Date().getDay(); // 0 Sun ... 6 Sat
      const isGameDay = (d: number) => d === 0 || d === 1 || d === 4; // Sun, Mon, Thu
      if (!isGameDay(dow)) {
        if (this.quota.getRemaining() > 0) await this.optimizeLineup();
        else this.audit.recordAction('lineup_skipped', { reason: 'quota_exhausted' });
      } else {
        this.audit.recordAction('lineup_defers_to_kickoff');
      }
      if (app.waiverAutomationEnabled) {
        if (this.quota.getRemaining() > 0) await this.processWaivers();
        else this.audit.recordAction('waivers_skipped', { reason: 'quota_exhausted' });
      } else {
        this.audit.recordAction('waivers_skipped', { reason: 'waiver_automation_disabled' });
      }
      // Immediate pickups (FA add/drop) daily pass
      if (app.pickupsAutomationEnabled) {
        if (this.quota.getRemaining() > 0) await this.processPickups();
        else this.audit.recordAction('pickups_skipped', { reason: 'quota_exhausted' });
      } else {
        this.audit.recordAction('pickups_skipped', { reason: 'pickups_automation_disabled' });
      }
      if (app.tradesAutomationEnabled) {
        try {
          const cfgMgr = new ConfigManager();
          const lp = cfgMgr.loadLeagueProfile(this.leagueKey);
          const dl = (lp as any)?.meta?.tradeEndDate;
          if (dl && new Date(dl).getTime() < Date.now()) {
            this.audit.recordAction('trades_skipped', { reason: 'trade_deadline_passed', deadline: dl });
          } else if (this.quota.getRemaining() > 0) {
            await this.evaluateTrades();
          } else {
            this.audit.recordAction('trades_skipped', { reason: 'quota_exhausted_eval' });
          }
        } catch {
          if (this.quota.getRemaining() > 0) await this.evaluateTrades();
        }
      } else {
        this.audit.recordAction('trades_skipped', { reason: 'trades_automation_disabled' });
      }

      if (app.tradeResponsesAutomationEnabled) {
        if (this.quota.getRemaining() > 0) {
          await this.processIncomingTradeOffers();
        } else {
          this.audit.recordAction('trades_incoming_skipped', { reason: 'quota_exhausted_incoming' });
        }
      } else {
        this.audit.recordAction('trades_incoming_skipped', { reason: 'trade_responses_disabled' });
      }
    });
    this.audit.recordAction('daily_end');
  }

  async runIncomingTradeCheck(): Promise<void> {
    await this.runTradeResponses();
  }

  async runTradeEvaluations(): Promise<void> {
    const app = new ConfigManager().loadAppSettings();
    if (!app.tradesAutomationEnabled) {
      this.audit.recordAction('trades_skipped', { reason: 'trades_automation_disabled' });
      return;
    }
    await this.evaluateTrades();
  }

  async runTradeResponses(): Promise<void> {
    const app = new ConfigManager().loadAppSettings();
    if (!app.tradeResponsesAutomationEnabled) {
      this.audit.recordAction('trades_incoming_skipped', { reason: 'trade_responses_disabled' });
      return;
    }
    await this.processIncomingTradeOffers();
  }

  // Evaluate immediate free-agent pickups and apply add/drops (strict drop enforcement when roster full)
  private async processPickups() {
    try {
      if (!this.decisions) { this.audit.recordAction('pickups_skipped', { reason: 'gemini_unavailable' }); return; }
      this.audit.recordAction('pickups_start');
      const league = await this.yahoo.getLeague(this.leagueKey);
      const teamInfo = await this.yahoo.getTeamInfo(this.teamKey);
      const available = await this.yahoo.getFreeAgents(this.leagueKey, 50);
      if (!Array.isArray(available) || available.length === 0) { this.audit.recordAction('pickups_skipped', { reason: 'no_available_players' }); return; }
      const entries = await this.yahoo.getTeamRosterWithSlots(this.teamKey);
      const myRoster = entries.map((e) => e.player);
      const decision = await (this.decisions as any).gemini.evaluateImmediatePickups(available, myRoster, 2, { week: league.currentWeek, season: league.season, leagueSettings: league.settings });
      // Enforce strict drops if roster full
      const rp: Record<string, number> = (league?.settings?.rosterPositions || {}) as any;
      const cap = Object.entries(rp).reduce((sum, [pos, cnt]) => { const up = String(pos || '').toUpperCase(); if (up==='IR') return sum; const n=Number(cnt); return sum + (Number.isFinite(n)?n:0); }, 0);
      const nonIrCount = entries.filter((e: any) => String(e.slot || '').toUpperCase() !== 'IR').length;
      const rosterFull = nonIrCount >= cap && cap > 0;
      const write = this.write;
      if (rosterFull) {
        // If any missing, skip to avoid Yahoo rejection
        const missing = (decision.claims || []).some((c: any) => !c.dropPlayerId);
        if (missing) { this.audit.recordAction('pickups_skipped', { reason: 'missing_drops' }); return; }
      }
      const app = new ConfigManager().loadAppSettings();
      if (app.applyChanges && (decision.claims || []).length > 0) {
        const res = await write.applyPickups(this.leagueKey, this.teamKey, decision as any);
        this.audit.recordAction(res.success ? 'pickups_applied' : 'pickups_apply_failed', { claims: decision.claims });
      } else {
        this.audit.recordAction('pickups_dry_run', { claims: decision.claims });
      }
      this.audit.recordAction('pickups_end');
    } catch (e) {
      this.audit.recordAction('pickups_unavailable', { error: (e as Error).message });
    }
  }

  // Public wrapper for weekly waiver scheduler
  async runWaivers(): Promise<void> {
    await this.processWaivers();
  }

  // Expose IR hygiene as a direct action
  async runIR(): Promise<void> {
    await this.runRosterHygiene();
  }

  // Expose trades automation (evaluate + respond) as a direct action
  async runTrades(): Promise<void> {
    await this.runTradeEvaluations();
    await this.runTradeResponses();
  }

  private async runRosterHygiene() {
    try {
      const app = new ConfigManager().loadAppSettings();
      if (!app.irAutomationEnabled) {
        this.audit.recordAction('hygiene_skipped', { reason: 'ir_automation_disabled' });
        return;
      }
      this.audit.recordAction('hygiene_start');
      const league = await this.yahoo.getLeague(this.leagueKey);
      const lpMgr = new ConfigManager();
      const leagueProfile = lpMgr.loadLeagueProfile(this.leagueKey);
      const cfgMgr2 = new ConfigManager();
      const leagueProfile2 = cfgMgr2.loadLeagueProfile(this.leagueKey);
      const entries = await this.yahoo.getTeamRosterWithSlots(this.teamKey);
      const ir = computeIrAssignments(entries as any, league.settings);
      const flex = computeFlexAssignments(entries as any, league.settings);
      const assignments = [...ir, ...flex];
      if (assignments.length === 0) {
        this.audit.recordAction('hygiene_noop');
        return;
      }
      const apply = app.applyChanges === true;
      if (apply) {
        const res = await this.write.applyAssignments(this.teamKey, assignments as any);
        this.audit.recordAction(res.success ? 'hygiene_applied' : 'hygiene_apply_failed', { count: assignments.length });
      } else {
        this.audit.recordAction('hygiene_dry_run', { count: assignments.length });
      }
      this.logger.info('Roster hygiene planned', { assignments });
      this.audit.recordAction('hygiene_end');
    } catch (e) {
      this.audit.recordError(e as Error, { phase: 'hygiene' });
    }
  }

  private async optimizeLineup() {
    try {
      if (!this.decisions) { this.audit.recordAction('lineup_skipped', { reason: 'gemini_unavailable' }); return; }
      this.audit.recordAction('lineup_opt_start');
      const league = await this.yahoo.getLeague(this.leagueKey);
      const cfgMgr = new ConfigManager();
      const leagueProfile = cfgMgr.loadLeagueProfile(this.leagueKey);
      // Prefer slot-aware entries; fall back to basic roster if needed (e.g., in tests)
      let rosterEntries: Array<{ slot?: string; player: any }>; // using any to avoid import cycle in controller
      try {
        // Use slot-aware parser to ensure robust roster extraction
        rosterEntries = await this.yahoo.getTeamRosterWithSlots(this.teamKey);
      } catch {
        const basic = await this.yahoo.getTeamRoster(this.teamKey);
        rosterEntries = basic.map((p: any) => ({ player: p }));
      }
      // Use roster as-is; do not enrich points
      const roster = rosterEntries.map((e) => e.player);
      if (!league?.settings) {
        this.audit.recordAction('lineup_skipped', { reason: 'insufficient_context', roster: roster.length });
        return;
      }

      this.audit.recordAction('lineup_roster_size', { size: roster.length });
      const lineup = await this.decisions.decideLineup(roster, league.settings, {
        week: league.currentWeek,
        season: league.season,
        leagueSettings: league.settings,
        leagueProfile,
        rosterWithSlots: rosterEntries, // surfaced for prompting
      } as any);
      this.logger.info('Lineup decision', { confidence: lineup.confidence, projected: lineup.projectedPoints });
      this.audit.recordAction('lineup_opt_result', { confidence: lineup.confidence, projected: lineup.projectedPoints, changes: lineup.changes?.length ?? 0 });
      const decision: BotDecision = {
        id: `lineup-${Date.now()}`,
        type: DecisionType.LINEUP_CHANGE,
        timestamp: new Date(),
        reasoning: lineup.reasoning,
        confidence: lineup.confidence,
        executed: false,
      };
      const apply = (this.decisions as any)['config']?.applyChanges === true;
      if (apply) {
        try {
          await this.write.applyLineup(this.teamKey, lineup.recommendedLineup);
          decision.executed = true;
          decision.outcome = 'Lineup updated';
          this.audit.recordAction('lineup_applied', { changes: lineup.changes });
        } catch (e) {
          decision.executed = false;
          decision.outcome = `Failed to update lineup: ${(e as Error).message}`;
          this.logger.warn('Failed to update lineup', { error: (e as Error).message });
          this.audit.recordAction('lineup_apply_failed', { error: (e as Error).message });
        }
      } else {
        decision.executed = false;
        decision.outcome = 'Dry run: lineup not applied';
        this.audit.recordAction('lineup_dry_run', { changes: lineup.changes });
      }
      this.audit.recordDecision(decision);
      this.audit.recordAction('lineup_opt_end');
    } catch (e) {
      this.logger.error('Lineup optimization failed', { error: (e as Error).message });
      this.audit.recordError(e as Error, { phase: 'optimizeLineup' });
    }
  }

  private async processWaivers() {
    try {
      if (!this.decisions) { this.audit.recordAction('waivers_skipped', { reason: 'gemini_unavailable' }); return; }
      this.audit.recordAction('waivers_start');
      const league = await this.yahoo.getLeague(this.leagueKey);
      const cfgMgr = new ConfigManager();
      const leagueProfile = cfgMgr.loadLeagueProfile(this.leagueKey);
      const ww = await this.yahoo.getWaiverWirePlayers(this.leagueKey);
      if (!Array.isArray(ww) || ww.length === 0) {
        this.audit.recordAction('waivers_skipped', { reason: 'no_candidates' });
        return;
      }
      // Fetch team FAAB balance if available
      let faabRemain: number | undefined;
      try {
        const ti = await this.yahoo.getTeamInfo(this.teamKey);
        if (Number.isFinite(Number(ti.faabBalance))) faabRemain = Number(ti.faabBalance);
      } catch {}

      const res = await this.decisions.decideWaivers(ww, {
        week: league.currentWeek,
        season: league.season,
        leagueSettings: league.settings,
        leagueProfile,
        faabBudgetRemaining: faabRemain,
        waiverType: (leagueProfile as any)?.meta?.waiverType || league.settings?.waiverType,
      } as any);
      // Enforce season acquisitions cap from league profile (if present)
      try {
        const capSeason = Number((leagueProfile as any)?.meta?.maxAcquisitionsSeason);
        if (Number.isFinite(capSeason) && capSeason > 0) {
          const trx = await this.yahoo.getAllTransactionsNormalized(this.leagueKey, this.teamKey, 400);
          const isMyAdd = (t: any) => {
            const okType = String(t?.type || '').toLowerCase().includes('add');
            const okStatus = String(t?.status || '').toLowerCase().includes('success');
            if (!okType || !okStatus) return false;
            if (Array.isArray(t?.moves)) return t.moves.some((m: any) => String(m?.type || '').toLowerCase() === 'add' && String(m?.destination || '').endsWith(this.teamKey.slice(this.teamKey.lastIndexOf('.t.'))));
            return true;
          };
          const addsSoFar = trx.filter(isMyAdd).length;
          const remainingAdds = Math.max(0, capSeason - addsSoFar);
          if (remainingAdds <= 0) {
            this.audit.recordAction('waivers_skipped', { reason: 'season_acquisitions_cap_reached' });
            return;
          }
          if (Array.isArray(res.claims) && res.claims.length > remainingAdds) {
            res.claims = res.claims.slice(0, remainingAdds);
            this.audit.recordAction('waivers_capped_by_season_limit', { remainingAdds });
          }
        }
      } catch {}

      // Attach FAAB bids for any claim missing bidAmount, using remaining budget
      if (res.claims && res.claims.length > 0) {
        const totalBudget = Number.isFinite(faabRemain as any) ? (faabRemain as number) : (parseInt(process.env.FAAB_BUDGET || '100', 10) || 100);
        const endWeek = (Array.isArray(league.settings?.playoffWeeks) && league.settings.playoffWeeks.length > 0)
          ? Math.min(...league.settings.playoffWeeks) - 1
          : 14;
        try {
          const { attachBids } = await import('../services/FAAB');
          // Only assign bids where missing; keep any Gemini-provided bidAmount as-is (but capped earlier)
          const needBids = (res.claims as any[]).some((c) => c.bidAmount === undefined);
          if (needBids) {
            const withBids = attachBids(res.claims as any, { totalBudget, week: league.currentWeek, endWeek });
            // Merge back: preserve existing bidAmount values
            res.claims = withBids.map((wb, idx) => {
              const orig = (res.claims as any[])[idx];
              return { ...wb, bidAmount: orig.bidAmount !== undefined ? orig.bidAmount : wb.bidAmount } as any;
            });
          }
        } catch {}
      }
      this.logger.info('Waiver decision', { count: res.claims.length, confidence: res.confidence });
      this.audit.recordAction('waivers_result', { count: res.claims.length, confidence: res.confidence });
      if (res.claims.length > 0) {
        const app = new ConfigManager().loadAppSettings();
        const applyW = app.applyChanges === true;
        if (applyW) {
          try {
            const out = await this.write.applyWaivers(this.leagueKey, this.teamKey, res);
            const decision: BotDecision = {
              id: `waivers-${Date.now()}`,
              type: DecisionType.WAIVER_CLAIM,
              timestamp: new Date(),
              reasoning: res.reasoning,
              confidence: res.confidence,
              executed: out.success,
              outcome: out.success ? 'Waiver claims submitted' : 'Waiver submit failed',
            };
            this.audit.recordDecision(decision);
            this.audit.recordAction(out.success ? 'waivers_applied' : 'waivers_apply_failed', { claims: res.claims });
          } catch (e) {
            this.logger.warn('Waiver submit error', { error: (e as Error).message });
            this.audit.recordError(e as Error, { phase: 'submitWaivers' });
          }
        } else {
          const decision: BotDecision = {
            id: `waivers-${Date.now()}`,
            type: DecisionType.WAIVER_CLAIM,
            timestamp: new Date(),
            reasoning: res.reasoning,
            confidence: res.confidence,
            executed: false,
            outcome: 'Dry run: waiver claims not submitted',
          };
          this.audit.recordDecision(decision);
          this.audit.recordAction('waivers_dry_run', { claims: res.claims });
        }
      }
      // Post-waiver pickups planning (optional, no writes)
      if (res.claims.length === 0 && /^1|true$/i.test(process.env.BOT_POST_WAIVER_PICKUP || '0')) {
        try {
          const fa = await this.yahoo.getWaiverWirePlayers(this.leagueKey);
          if (Array.isArray(fa) && fa.length > 0) {
            const plan = await this.decisions.decideWaivers(fa, {
              week: league.currentWeek,
              season: league.season,
              leagueSettings: league.settings,
            } as any);
            this.audit.recordAction('post_waiver_plan', { count: plan.claims.length });
          }
        } catch {}
      }
      this.audit.recordAction('waivers_end');
    } catch (e) {
      // Soften failures to avoid noisy errors; waivers may not be available at all times
      this.logger.warn('Waiver processing unavailable', { error: (e as Error).message });
      this.audit.recordAction('waivers_unavailable', { error: (e as Error).message });
    }
  }

  private async evaluateTrades() {
    try {
      if (!this.decisions) { this.audit.recordAction('trades_skipped', { reason: 'gemini_unavailable' }); return; }
      this.audit.recordAction('trades_start');
      const league = await this.yahoo.getLeague(this.leagueKey);
      const cfgMgr = new ConfigManager();
      const leagueProfile = cfgMgr.loadLeagueProfile(this.leagueKey);
      // Check season trade cap
      try {
        const capTrades = Number((leagueProfile as any)?.meta?.maxTradesSeason);
        if (Number.isFinite(capTrades) && capTrades > 0) {
          const trx = await this.yahoo.getAllTransactionsNormalized(this.leagueKey, this.teamKey, 400);
          const myTrades = trx.filter((t: any) => String(t?.type || '').toLowerCase().includes('trade') && String(t?.status || '').toLowerCase().includes('success'));
          if (myTrades.length >= capTrades) {
            this.audit.recordAction('trades_skipped', { reason: 'season_trade_cap_reached' });
            return;
          }
        }
      } catch {}
      // Build my roster once
      const myEntries = await this.yahoo.getTeamRosterWithSlots(this.teamKey);
      const my = myEntries.map((e) => e.player);
      if (my.length === 0) { this.audit.recordAction('trades_skipped', { reason: 'empty_roster' }); return; }

      // Fetch all league teams and build opponent roster list
      let opponentTeams: Array<{ key: string; name?: string }> = [];
      try { opponentTeams = await this.yahoo.getLeagueTeams(this.leagueKey); } catch {}
      const myKeySuffix = (() => { const idx = this.teamKey.lastIndexOf('.t.'); return idx > 0 ? this.teamKey.slice(idx + 3) : ''; })();
      const isMe = (k: string) => k === this.teamKey || (myKeySuffix && k.endsWith('.t.' + myKeySuffix));
      const candidates = (opponentTeams || []).filter((t) => t?.key && !isMe(String(t.key)));
      if (candidates.length === 0) { this.audit.recordAction('trades_skipped', { reason: 'no_other_teams' }); return; }

      // Pull each opponent roster (Yahoo calls), then single Gemini call for the best trade across all
      const oppList: Array<{ teamKey: string; teamName?: string; roster: any[] }> = [];
      for (const opp of candidates) {
        try {
          const entries = await this.yahoo.getTeamRosterWithSlots(String(opp.key));
          const their = entries.map((e) => e.player);
          if (their.length > 0) oppList.push({ teamKey: String(opp.key), teamName: opp.name, roster: their });
        } catch (e) {
          this.audit.recordError(e as Error, { phase: 'fetchOpponentRoster', opponent: opp.key });
        }
      }
      if (oppList.length === 0) { this.audit.recordAction('trades_skipped', { reason: 'no_opponent_rosters' }); return; }

      this.audit.recordAction('trade_multi_eval_start', { opponents: oppList.length });
      const res = await this.decisions.decideTradeMulti(my, oppList, {
        week: league.currentWeek,
        season: league.season,
        leagueSettings: league.settings,
        leagueProfile,
      } as any);
      this.audit.recordAction('trade_multi_eval_end', { shouldTrade: res.shouldTrade, expectedValue: res.expectedValue, confidence: res.confidence });
      if (!res.shouldTrade || !res.proposal) {
        this.logger.info('No trade proposed', { confidence: res.confidence, expectedValue: res.expectedValue });
        this.audit.recordAction('trades_no_proposal', { confidence: res.confidence, expectedValue: res.expectedValue });
        return;
      }
      if (!res.shouldTrade || !res.proposal) {
        this.logger.info('No trade proposed', { confidence: res.confidence, expectedValue: res.expectedValue });
        this.audit.recordAction('trades_no_proposal', { confidence: res.confidence, expectedValue: res.expectedValue });
        return;
      }
      const app = new ConfigManager().loadAppSettings();
      const applyT = app.applyChanges === true;
      if (applyT) {
        try {
          const out = await this.write.applyTrade(this.leagueKey, this.teamKey, res);
          const decision: BotDecision = {
            id: `trade-${Date.now()}`,
            type: DecisionType.TRADE_PROPOSAL,
            timestamp: new Date(),
            reasoning: res.reasoning,
            confidence: res.confidence,
            executed: out.success,
            outcome: out.success ? `Trade proposed (${out.id})` : 'Trade proposal failed',
          };
          this.audit.recordDecision(decision);
          this.audit.recordAction(out.success ? 'trade_applied' : 'trade_apply_failed', { proposal: res.proposal });
        } catch (e) {
          this.logger.warn('Trade proposal error', { error: (e as Error).message });
          this.audit.recordError(e as Error, { phase: 'proposeTrade' });
        }
      } else {
        const decision: BotDecision = {
          id: `trade-${Date.now()}`,
          type: DecisionType.TRADE_PROPOSAL,
          timestamp: new Date(),
          reasoning: res.reasoning,
          confidence: res.confidence,
          executed: false,
          outcome: 'Dry run: trade not proposed',
        };
        this.audit.recordDecision(decision);
        this.audit.recordAction('trade_dry_run', { proposal: res.proposal });
      }
      this.audit.recordAction('trades_end');
    } catch (e) {
      // Trades may not be applicable; treat as soft failure
      this.logger.warn('Trade evaluation unavailable', { error: (e as Error).message });
      this.audit.recordAction('trade_unavailable', { error: (e as Error).message });
    }
  }

  // Check incoming trade offers and auto-respond per thresholds
  private async processIncomingTradeOffers() {
    try {
      if (!this.decisions) { this.audit.recordAction('trades_incoming_skipped', { reason: 'gemini_unavailable' }); return; }
      const app = new ConfigManager().loadAppSettings();
      if (!app.tradeResponsesAutomationEnabled) { this.audit.recordAction('trades_incoming_skipped', { reason: 'trade_responses_disabled' }); return; }
      // Respect season trade cap from league profile
      try {
        const cfgMgr = new ConfigManager();
        const lp = cfgMgr.loadLeagueProfile(this.leagueKey);
        const capTrades = Number((lp as any)?.meta?.maxTradesSeason);
        if (Number.isFinite(capTrades) && capTrades > 0) {
          const trx = await this.yahoo.getAllTransactionsNormalized(this.leagueKey, this.teamKey, 400);
          const myTrades = trx.filter((t: any) => String(t?.type || '').toLowerCase().includes('trade') && String(t?.status || '').toLowerCase().includes('success'));
          if (myTrades.length >= capTrades) {
            this.audit.recordAction('trades_incoming_skipped', { reason: 'season_trade_cap_reached' });
            return;
          }
        }
      } catch {}
      const offers = await this.yahoo.getPendingTrades(this.leagueKey);
      if (!Array.isArray(offers) || offers.length === 0) { this.audit.recordAction('trades_incoming_none'); return; }
      // Compute needs/surplus via Gemini
      const league = await this.yahoo.getLeague(this.leagueKey);
      const lpMgr = new ConfigManager();
      const leagueProfile = lpMgr.loadLeagueProfile(this.leagueKey);
      const myEntries = await this.yahoo.getTeamRosterWithSlots(this.teamKey);
      const myRoster = myEntries.map((e) => e.player);
      let needs: string[] = [];
      let surplus: string[] = [];
      try {
        const gemini = new (require('../services/GeminiClient').GeminiClient)();
        const out = await gemini.analyzeRosterBalance(myRoster, league.settings);
        needs = Array.isArray(out.needs) ? out.needs : [];
        surplus = Array.isArray(out.surplus) ? out.surplus : [];
      } catch {}
      const gemini = new (require('../services/GeminiClient').GeminiClient)();
      // Limit number of offers evaluated by remaining budget
      let remaining = this.quota.getRemaining();
      for (const offer of offers) {
        if (remaining <= 0) { this.audit.recordAction('trades_incoming_budget_exhausted'); break; }
        const tradeId = String(offer.id || '');
        let accept = false;
        try {
          if (offer.moves && offer.moves.length > 0) {
            const decision = await gemini.evaluateIncomingTradeOffer(myRoster, league.settings, needs, surplus, offer.moves, this.teamKey, leagueProfile);
            accept = !!decision.shouldAccept && (decision.confidence ?? 0) >= 0.6;
            this.audit.recordAction('trade_incoming_eval', { tradeId, accept, confidence: decision.confidence, reasoning: decision.reasoning });
            remaining = this.quota.getRemaining(); // update after a call
          } else {
            this.audit.recordAction('trade_incoming_unparsed', { tradeId });
          }
        } catch (e) {
          this.audit.recordError(e as Error, { phase: 'trades_incoming_eval', tradeId });
          accept = false;
        }
        const app = new ConfigManager().loadAppSettings();
        const apply = app.applyChanges === true;
        if (apply) {
          const res = await this.write.applyTradeResponse(this.leagueKey, tradeId, accept);
          this.audit.recordAction(res.success ? (accept ? 'trade_auto_accepted' : 'trade_auto_declined') : 'trade_auto_response_failed', { tradeId });
        } else {
          this.audit.recordAction(accept ? 'trade_auto_accept_dry_run' : 'trade_auto_decline_dry_run', { tradeId });
        }
      }
    } catch (e) {
      this.audit.recordError(e as Error, { phase: 'trades_incoming' });
    }
  }

  // Lightweight kickoff-time check: run hygiene and lineup optimization
  async runKickoffCheck(): Promise<void> {
    try {
      this.audit.recordAction('kickoff_check_start');
      await this.runRosterHygiene();
      await this.optimizeLineup();
      this.audit.recordAction('kickoff_check_end');
    } catch (e) {
      this.audit.recordError(e as Error, { phase: 'kickoff_check' });
    }
  }
}
