import { describe, it, expect } from 'vitest';
import { mapPlayersFromRosterResponse, mapFreeAgentsFromLeaguePlayersResponse, extractLeagueTeams } from '../src/clients/yahooParsers.js';

const sampleRoster = {
  fantasy_content: {
    team: [
      { team_key: 'nfl.l.12345.t.7' },
      {
        roster: {
          players: {
            player: [
              { player: { player_id: '1', name: { full: 'John Doe' }, eligible_positions: { position: ['WR'] }, editorial_team_abbr: 'KC' } },
              { player: { player_id: '2', name: { full: 'Jane RB' }, eligible_positions: { position: ['RB'] }, editorial_team_abbr: 'SF' } }
            ]
          }
        }
      }
    ]
  }
};

const sampleLeaguePlayers = {
  fantasy_content: {
    league: {
      players: {
        player: [
          { player: { player_id: '10', name: { full: 'Free Agent A' }, eligible_positions: { position: ['QB'] } } },
          { player: { player_id: '11', name: { full: 'Free Agent B' }, eligible_positions: { position: ['TE'] } } }
        ]
      }
    }
  }
};

const sampleLeagueTeams = {
  fantasy_content: {
    league: {
      teams: {
        team: [
          { team_key: 'nfl.l.12345.t.1', name: 'Team 1' },
          { team_key: 'nfl.l.12345.t.2', name: 'Team 2' }
        ]
      }
    }
  }
};

describe('yahooParsers', () => {
  it('maps roster players', () => {
    const out = mapPlayersFromRosterResponse(sampleRoster as any);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ player_id: '1', name: 'John Doe', eligible_positions: ['WR'], team: 'KC' });
  });

  it('maps free agents', () => {
    const out = mapFreeAgentsFromLeaguePlayersResponse(sampleLeaguePlayers as any);
    expect(out.map((p) => p.name)).toEqual(['Free Agent A', 'Free Agent B']);
  });

  it('extracts league teams', () => {
    const out = extractLeagueTeams(sampleLeagueTeams as any);
    expect(out).toEqual([
      { team_key: 'nfl.l.12345.t.1', name: 'Team 1' },
      { team_key: 'nfl.l.12345.t.2', name: 'Team 2' }
    ]);
  });
});

