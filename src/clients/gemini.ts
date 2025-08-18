// Thin wrapper around Gemini for strategy decisions.
// Uses @google/generative-ai if available; otherwise, falls back to REST fetch.

import { config, assertSecrets } from '../config.js';
import { logger } from '../logger.js';

type ModelClient = {
  generate: (prompt: string) => Promise<string>;
};

class GeminiClient implements ModelClient {
  private apiKey: string;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generate(prompt: string): Promise<string> {
    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=' + this.apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('No text in Gemini response');
      return text as string;
    } catch (err) {
      logger.error('Gemini generate failed', err);
      throw err;
    }
  }
}

let singleton: ModelClient | null = null;

export function getModel(): ModelClient {
  if (singleton) return singleton;
  assertSecrets(); // ensure GEMINI_API_KEY and Yahoo vars exist
  singleton = new GeminiClient(config.geminiApiKey!);
  return singleton;
}
