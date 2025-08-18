// Stub news provider; wire up to real sources (Sleeper, FantasyPros, etc.).
// Return items with at least: playerName, headline, ts (epoch seconds)

export type NewsItem = {
  playerName: string;
  headline: string;
  ts: number;
};

export interface NewsProvider {
  fetchPlayerNews(playerNames: string[], since?: number): Promise<NewsItem[]>;
}

class NoopNewsProvider implements NewsProvider {
  async fetchPlayerNews(_playerNames: string[], _since?: number): Promise<NewsItem[]> {
    return [];
  }
}

let provider: NewsProvider = new NoopNewsProvider();

export function getNewsProvider(): NewsProvider {
  return provider;
}

export function setNewsProvider(p: NewsProvider) {
  provider = p;
}

