import { Player, Position, PlayerStatus } from '../../src/models';

describe('Player Model', () => {
  it('should create a valid player object', () => {
    const player: Player = {
      id: 'player-123',
      name: 'Test Player',
      position: Position.QB,
      team: 'TEST',
      status: PlayerStatus.ACTIVE,
      projectedPoints: 15.5,
      averagePoints: 14.2,
    };

    expect(player.id).toBe('player-123');
    expect(player.name).toBe('Test Player');
    expect(player.position).toBe(Position.QB);
    expect(player.status).toBe(PlayerStatus.ACTIVE);
  });

  it('should handle optional matchup data', () => {
    const player: Player = {
      id: 'player-456',
      name: 'Another Player',
      position: Position.RB,
      team: 'TEST2',
      status: PlayerStatus.QUESTIONABLE,
      projectedPoints: 12.0,
      averagePoints: 11.5,
      matchup: {
        opponent: 'OPP',
        isHome: true,
        gameTime: new Date('2024-01-01T13:00:00Z'),
      },
    };

    expect(player.matchup).toBeDefined();
    expect(player.matchup?.opponent).toBe('OPP');
    expect(player.matchup?.isHome).toBe(true);
  });
});