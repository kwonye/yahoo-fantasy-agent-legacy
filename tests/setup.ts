// Jest test setup configuration
// Load test-specific environment variables from config/test-settings.json
import fs from 'fs';
import path from 'path';

try {
	const p = path.join(process.cwd(), 'config', 'test-settings.json');
	const raw = fs.readFileSync(p, 'utf8');
	const cfg = JSON.parse(raw);
	for (const k of Object.keys(cfg)) {
		if (!process.env[k]) process.env[k] = String(cfg[k]);
	}
		// ensure NODE_ENV for tests
		(process.env as any).NODE_ENV = process.env.NODE_ENV || 'test';
} catch (e) {
	// ignore if not present
}