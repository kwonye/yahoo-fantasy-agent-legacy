import { filterActionableIncomingTrades } from '../../src/lib/tradeFilters';

const buildRaw = (trader: string, tradee: string, canRespond: boolean | number = 1) => ([
  {
    trader_team_key: trader,
    tradee_team_key: tradee,
    current_login_can_respond: canRespond,
  },
]);

describe('filterActionableIncomingTrades', () => {
  const myTeamKey = 'nfl.l.123.t.1';
  const otherTeamKey = 'nfl.l.123.t.2';

  it('keeps only trades that target my team', () => {
    const trades = [
      {
        id: 'incoming',
        status: 'proposed',
        moves: [{ source: otherTeamKey, destination: myTeamKey }],
        raw: buildRaw(otherTeamKey, myTeamKey),
      },
      {
        id: 'outgoing',
        status: 'proposed',
        moves: [{ source: myTeamKey, destination: otherTeamKey }],
        raw: buildRaw(myTeamKey, otherTeamKey),
      },
    ];

    const filtered = filterActionableIncomingTrades(trades, myTeamKey);

    expect(filtered.map((t) => t.id)).toEqual(['incoming']);
  });

  it('falls back to any actionable trade when none are marked as proposed', () => {
    const trades = [
      {
        id: 'incoming',
        status: 'awaiting review',
        moves: [{ source: otherTeamKey, destination: myTeamKey }],
        raw: buildRaw(otherTeamKey, myTeamKey),
      },
    ];

    const filtered = filterActionableIncomingTrades(trades, myTeamKey);

    expect(filtered.map((t) => t.id)).toEqual(['incoming']);
  });
});
