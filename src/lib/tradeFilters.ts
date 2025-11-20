export function filterActionableIncomingTrades(trades: any[], myTeamKey?: string): any[] {
  if (!Array.isArray(trades) || trades.length === 0) return [];
  const normalizedTeamKey = typeof myTeamKey === 'string' ? myTeamKey : '';
  const myTeamNum = (() => {
    if (!normalizedTeamKey) return '';
    const idx = normalizedTeamKey.lastIndexOf('.t.');
    return idx > 0 ? normalizedTeamKey.slice(idx + 3) : '';
  })();

  const matchesTeamKey = (value?: string | null): boolean => {
    if (!value) return false;
    const str = String(value);
    if (normalizedTeamKey && str === normalizedTeamKey) return true;
    if (!myTeamNum) return false;
    if (str === myTeamNum) return true;
    return str.endsWith('.t.' + myTeamNum);
  };

  const extractMetaValue = (node: any, keys: string[]): any => {
    for (const key of keys) {
      if (key in (node || {})) return (node as any)[key];
      const alt = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (alt in (node || {})) return (node as any)[alt];
    }
    return undefined;
  };

  const isIncomingForMe = (trade: any): boolean => {
    if (!normalizedTeamKey) return true;
    const rawNodes: any[] = Array.isArray(trade?.raw) ? trade.raw : [];
    let traderKey: string | undefined;
    let tradeeKey: string | undefined;
    let canRespond: any;
    for (const node of rawNodes) {
      if (!node || typeof node !== 'object') continue;
      if (traderKey === undefined) {
        const v = extractMetaValue(node, ['trader_team_key', 'trader_team_id']);
        if (typeof v === 'string') traderKey = v;
      }
      if (tradeeKey === undefined) {
        const v = extractMetaValue(node, ['tradee_team_key', 'tradee_team_id', 'tradee']);
        if (typeof v === 'string') tradeeKey = v;
      }
      if (canRespond === undefined) {
        canRespond = extractMetaValue(node, ['current_login_can_respond']);
      }
    }
    const traderMatches = traderKey ? matchesTeamKey(traderKey) : false;
    const tradeeMatches = tradeeKey ? matchesTeamKey(tradeeKey) : false;
    const canRespondBool = (() => {
      if (canRespond === undefined || canRespond === null) return undefined;
      if (typeof canRespond === 'number') return canRespond > 0;
      if (typeof canRespond === 'string') {
        const norm = canRespond.trim().toLowerCase();
        if (norm === '1' || norm === 'true') return true;
        if (norm === '0' || norm === 'false') return false;
      }
      return Boolean(canRespond);
    })();
    if (traderMatches) return false;
    if (tradeeMatches) return true;
    if (canRespondBool === true) return true;
    return false;
  };

  const involvesTeam = (trade: any): boolean => {
    if (!normalizedTeamKey) return true;
    if (Array.isArray(trade?.teamKeys) && trade.teamKeys.some((k: string) => matchesTeamKey(k))) return true;
    if (Array.isArray(trade?.teamIds) && trade.teamIds.some((k: string) => matchesTeamKey(k))) return true;
    if (Array.isArray(trade?.moves) && trade.moves.some((m: any) => matchesTeamKey(m?.source) || matchesTeamKey(m?.destination))) return true;
    const seen = new Set<any>();
    const scan = (node: any): boolean => {
      if (!node || typeof node !== 'object') return false;
      if (seen.has(node)) return false;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const child of node) {
          if (typeof child === 'string' && matchesTeamKey(child)) return true;
          if (typeof child === 'object' && scan(child)) return true;
        }
        return false;
      }
      for (const value of Object.values(node)) {
        if (typeof value === 'string' && matchesTeamKey(value)) return true;
        if (typeof value === 'object' && scan(value)) return true;
      }
      return false;
    };
    try {
      if (trade?.raw && scan(trade.raw)) return true;
    } catch {}
    return false;
  };

  const includesMyTeamInMoves = (trade: any): boolean => {
    if (!normalizedTeamKey) return true;
    const moves = Array.isArray(trade?.moves) ? trade.moves : [];
    if (moves.length === 0) return true;
    return moves.some((m: any) => matchesTeamKey(m?.source) || matchesTeamKey(m?.destination));
  };

  const statusMatches = (trade: any, keyword: string): boolean => {
    const needle = keyword.toLowerCase();
    const direct = String(trade?.status || '').toLowerCase();
    if (direct.includes(needle)) return true;
    try {
      const seen = new Set<any>();
      const scan = (node: any, keyHint = ''): boolean => {
        if (typeof node === 'string') {
          if (keyHint.toLowerCase().includes('status') && node.toLowerCase().includes(needle)) return true;
          return false;
        }
        if (!node || typeof node !== 'object') return false;
        if (seen.has(node)) return false;
        seen.add(node);
        if (Array.isArray(node)) {
          for (const child of node) {
            if (scan(child, keyHint)) return true;
          }
          return false;
        }
        for (const [k, v] of Object.entries(node)) {
          if (typeof v === 'string') {
            if (k.toLowerCase().includes('status') && v.toLowerCase().includes(needle)) return true;
          } else if (scan(v, k)) {
            return true;
          }
        }
        return false;
      };
      if (trade?.raw && scan(trade.raw)) return true;
    } catch {}
    return false;
  };

  const isProposed = (trade: any) => statusMatches(trade, 'propos');
  const isSuccessful = (trade: any) => statusMatches(trade, 'success');

  const dedupedTrades = (() => {
    const seen = new Set<string>();
    const output: any[] = [];
    for (const trade of trades) {
      if (!trade) continue;
      const id = String(trade?.id || '');
      const key = id || JSON.stringify({ moves: trade?.moves || [], teamKeys: trade?.teamKeys || [] });
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(trade);
    }
    return output;
  })();

  const withoutSuccessful = dedupedTrades.filter((trade) => !isSuccessful(trade));
  const involvingMine = withoutSuccessful.filter(involvesTeam).filter(includesMyTeamInMoves);
  const pending = involvingMine.filter(isProposed);
  const incomingPending = pending.filter(isIncomingForMe);
  const incomingAll = involvingMine.filter(isIncomingForMe);
  return incomingPending.length > 0 ? incomingPending : incomingAll;
}
