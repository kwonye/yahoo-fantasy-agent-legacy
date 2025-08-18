import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SleeperNewsProvider } from '../src/news/sleeperProvider.js';

describe('SleeperNewsProvider', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    // @ts-ignore
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ([
      { title: 'Player John Doe out for Week 1', created: Math.floor(Date.now()/1000) },
      { title: 'Misc unrelated news', created: Math.floor(Date.now()/1000) },
    ]) })) as any;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('filters news by player names and since cutoff', async () => {
    const p = new SleeperNewsProvider();
    const names = ['John Doe', 'Jane Smith'];
    const since = Math.floor(Date.now()/1000) - 60;
    const items = await p.fetchPlayerNews(names, since);
    expect(items.length).toBe(1);
    expect(items[0].playerName).toBe('john doe');
  });
});

