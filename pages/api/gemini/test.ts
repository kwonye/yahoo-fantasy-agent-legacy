import type { NextApiRequest, NextApiResponse } from 'next';
import { ConfigManager } from '../../../src/services/ConfigManager';
import { GeminiClient } from '../../../src/services/GeminiClient';
import { requireApiAuth } from '../../../src/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireApiAuth(req, res)) return;
  try {
    const prompt = String(req.body?.prompt || '').trim();
    const cm = new ConfigManager();
    const g = cm.loadGeminiCredentials();
    if (!g || !g.apiKey) { res.status(400).json({ ok: false, error: 'Gemini API key missing' }); return; }
    if (!prompt) { res.status(400).json({ ok: false, error: 'Prompt required' }); return; }
    const client = new GeminiClient();
    const text = await client.generate(g.model || 'gemini-2.5-pro', prompt);
    res.json({ ok: true, response: text });
  } catch (e: any) { res.status(500).json({ ok: false, error: e?.message || String(e) }); }
}
