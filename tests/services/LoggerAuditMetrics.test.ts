import fs from 'fs';
import path from 'path';
import os from 'os';
import { Logger } from '../../src/services/Logger';
import { AuditTrail } from '../../src/services/AuditTrail';
import { Metrics } from '../../src/services/Metrics';
import { DecisionType } from '../../src/models';

describe('Logger, AuditTrail, Metrics', () => {
  it('logs structured JSON', () => {
    const logger = new Logger({ level: 'debug', service: 'test' } as any);
    const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined as unknown as never);
    logger.info('hello', { a: 1 });
    expect(spy).toHaveBeenCalled();
    const arg = (spy.mock.calls[0]?.[0] ?? '{}') as string;
    const obj = JSON.parse(arg);
    expect(obj.level).toBe('info');
    expect(obj.service).toBe('test');
    expect(obj.meta.a).toBe(1);
    spy.mockRestore();
  });

  it('writes audit entries to file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
    const audit = new AuditTrail({ dir, filename: 'a.log' });
    audit.recordDecision({
      id: '1',
      type: DecisionType.WAIVER_CLAIM,
      timestamp: new Date(),
      reasoning: 'test',
      confidence: 0.9,
      executed: false,
    });
    const content = fs.readFileSync(path.join(dir, 'a.log'), 'utf8');
    expect(content).toContain('decision');
  });

  it('counts and times operations', async () => {
    const m = new Metrics();
    m.inc('calls');
    await m.time('op', async () => new Promise((r) => setTimeout(r, 10)));
    expect(m.counters.calls).toBe(1);
    const arr = m.timings.op!;
    expect(arr.length).toBe(1);
  });
});
