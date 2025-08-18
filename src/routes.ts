import { Router } from 'express';
import { assertSecrets, config } from './config.js';
import { getAuthUrl, exchangeCodeForTokens } from './clients/yahooAuth.js';
import { runLineup, runTrade, runWaivers } from './services/managerService.js';
import { loadTokens } from './store/tokenStore.js';

export const router = Router();

router.get('/auth/login', (req, res) => {
  assertSecrets();
  const state = (req.query.state as string) || 'state123';
  const url = getAuthUrl(state);
  res.redirect(url);
});

router.get('/auth/callback', async (req, res) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  if (!code) return res.status(400).json({ error: 'Missing code' });
  await exchangeCodeForTokens(code);
  res.json({ ok: true, state, tokens: !!loadTokens() });
});

router.get('/config', (_req, res) => {
  res.json({
    leagueKey: config.leagueKey,
    teamKey: config.teamKey,
    hasTokens: !!loadTokens(),
    hasAI: !!config.geminiApiKey,
  });
});

router.post('/actions/lineup', async (_req, res) => {
  try {
    const result = await runLineup();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed lineup' });
  }
});

router.post('/actions/waivers', async (_req, res) => {
  try {
    const result = await runWaivers();
    res.json(result ?? { applied: false, rationale: 'No waiver move' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed waivers' });
  }
});

router.post('/actions/trades', async (_req, res) => {
  try {
    const result = await runTrade();
    res.json(result ?? { proposed: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed trade' });
  }
});

router.post('/actions/run-all', async (_req, res) => {
  try {
    const lineup = await runLineup();
    const waivers = await runWaivers();
    const trade = await runTrade();
    res.json({ lineup, waivers, trade });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed run-all' });
  }
});
