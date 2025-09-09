import fs from 'fs';
import os from 'os';
import path from 'path';
import { YahooWriteAdapter } from '../../src/services/YahooWriteAdapter';

describe('YahooWriteAdapter', () => {
  const fakeApi = {
    setLineup: jest.fn().mockResolvedValue(undefined),
    submitWaiverClaims: jest.fn().mockResolvedValue({ success: true }),
    proposeTrade: jest.fn().mockResolvedValue({ success: true, id: 't1' }),
    updateRosterXml: jest.fn().mockResolvedValue({ success: true }),
    submitTransactionsXml: jest.fn().mockResolvedValue({ success: true, id: 'x1' }),
    proposeTradeXml: jest.fn().mockResolvedValue({ success: true, id: 'x2' }),
  } as any;

  it('creates lineup assignments and dumps payload', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ywrite-'));
    process.env.DEBUG_YAHOO = '1';
    const adapter = new YahooWriteAdapter(fakeApi, { dumpDir: dir });
    const target = { starters: { QB: { id: 'p1', name: 'QB', position: 'QB', team: 'X', status: 'ACTIVE', projectedPoints: 0, averagePoints: 0 } }, bench: [] } as any;
    const assignments = adapter.planLineupAssignments([], target);
    const first = assignments[0]!;
    expect(first.playerId).toBe('p1');
    await adapter.applyLineup('team', target);
    const files = fs.readdirSync(dir).filter(f => f.includes('lineup'));
    expect(files.length).toBeGreaterThan(0);
  });

  it('builds waiver and trade payloads and calls api', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ywrite-'));
    process.env.DEBUG_YAHOO = '1';
    const adapter = new YahooWriteAdapter(fakeApi, { dumpDir: dir });
    await adapter.applyWaivers('league', { claims: [{ playerId: 'add1', priority: 1, reasoning: 'test' }], reasoning: 'r', confidence: 1, expectedValue: 1 });
    await adapter.applyTrade('league', { shouldTrade: true, reasoning: 'r', confidence: 1, expectedValue: 1, proposal: { myPlayers: ['a'], theirPlayers: ['b'], targetTeamId: 't', reasoning: 'r' } });
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
  });
});
