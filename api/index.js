// Vercel serverless entry that wraps the Express app
const path = require('path');
const serverless = require('serverless-http');

let app;
try {
  // Prefer compiled server if available
  const compiled = path.join(process.cwd(), 'dist', 'web', 'server.js');
  if (require('fs').existsSync(compiled)) {
    app = require(compiled).app || require(compiled).default || require(compiled);
  }
} catch (e) {
  // ignore
}

if (!app) {
  // Fall back to source (TypeScript) when running locally in dev if ts-node available
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require(path.join(process.cwd(), 'src', 'web', 'server.js'));
    app = src.app || src.default || src;
  } catch (e) {
    try {
      const tsnode = require('ts-node');
      tsnode.register({ transpileOnly: true, project: path.join(process.cwd(), 'tsconfig.json') });
      const srcTs = require(path.join(process.cwd(), 'src', 'web', 'server.ts'));
      app = srcTs.app || srcTs.default || srcTs;
    } catch (e2) {
      console.error('Could not load server app for Vercel function:', e2 || e);
    }
  }
}

if (!app) {
  module.exports = (req, res) => {
    res.status(500).send('Server app not available');
  };
} else {
  module.exports = serverless(app);
}
