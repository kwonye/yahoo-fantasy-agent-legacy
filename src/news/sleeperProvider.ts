import { NewsItem, NewsProvider } from './newsProvider.js';
import { logger } from '../logger.js';

type SleeperNews = {
  title?: string;
  body?: string;
  created?: number; // epoch seconds
  updated?: number; // epoch seconds
  category?: string;
  source?: string;
};

export class SleeperNewsProvider implements NewsProvider {
  async fetchPlayerNews(playerNames: string[], since?: number): Promise<NewsItem[]> {
    try {
      const res = await fetch('https://api.sleeper.app/v1/nfl/news');
      if (!res.ok) {
        logger.warn('Sleeper news fetch failed: ' + res.status);
        return [];
      }
      const data = (await res.json()) as SleeperNews[];
      const cutoff = since ?? Math.floor(Date.now() / 1000) - 3600;
      const items: NewsItem[] = [];
      const lowerNames = playerNames.map((n) => n.toLowerCase());
      for (const n of data) {
        const ts = n.updated ?? n.created ?? 0;
        if (ts < cutoff) continue;
        const text = `${n.title ?? ''} ${n.body ?? ''}`.toLowerCase();
        if (!text.trim()) continue;
        // naive match: any full name appears in text
        const match = lowerNames.find((nm) => nm && text.includes(nm));
        if (match) {
          items.push({ playerName: match, headline: n.title ?? n.body ?? 'news', ts });
        }
      }
      return items;
    } catch (e) {
      logger.warn('Sleeper news fetch error', e);
      return [];
    }
  }
}

