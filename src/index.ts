import express from 'express';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import cookieParser from 'cookie-parser';
import { router } from './routes.js';
import { scheduleJobs } from './scheduler.js';
import { logger } from './logger.js';
import { config } from './config.js';
import { setNewsProvider } from './news/newsProvider.js';
import { SleeperNewsProvider } from './news/sleeperProvider.js';

export const app = express();
app.use(express.json());
app.use(cookieParser());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/', router);

export function ensureSelfSignedCert(): { keyFile: string; certFile: string } | null {
  try {
    const sslDir = path.join(process.cwd(), 'data', 'ssl');
    const keyFile = path.join(sslDir, 'localhost-key.pem');
    const certFile = path.join(sslDir, 'localhost.pem');
    if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
      return { keyFile, certFile };
    }
    fs.mkdirSync(sslDir, { recursive: true });
    // Generate self-signed cert valid for localhost using openssl
    // CN=localhost, 365 days, RSA 2048
    execSync(
      `openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout ${keyFile} -out ${certFile} -subj "/CN=localhost"`,
      { stdio: 'ignore' },
    );
    return { keyFile, certFile };
  } catch (err) {
    logger.warn('Failed to generate self-signed cert (openssl missing?)');
    return null;
  }
}

export function startServer() {
  const httpPort = Number(process.env.PORT || 3000);
  const httpsPort = Number(process.env.HTTPS_PORT || 3443);
  const keyPath = process.env.SSL_KEY_PATH;
  const certPath = process.env.SSL_CERT_PATH;

  // Always start HTTP server (healthcheck and local access)
  app.listen(httpPort, () => {
    logger.info(`HTTP server listening on http://localhost:${httpPort}`);
    if (config.newsProvider === 'sleeper') setNewsProvider(new SleeperNewsProvider());
    scheduleJobs();
  });

  // Optionally start HTTPS server for OAuth callback
  const shouldEnableHttps =
    !!(keyPath && certPath) ||
    process.env.ENABLE_SELF_SIGNED_TLS === 'true' ||
    config.yahooRedirectUri?.startsWith('https://localhost:');

  if (shouldEnableHttps) {
    let finalKey = keyPath;
    let finalCert = certPath;
    if (!finalKey || !finalCert) {
      const generated = ensureSelfSignedCert();
      if (generated) {
        finalKey = generated.keyFile;
        finalCert = generated.certFile;
      }
    }
    if (finalKey && finalCert) {
      const httpsServer = https.createServer(
        {
          key: fs.readFileSync(finalKey),
          cert: fs.readFileSync(finalCert),
        },
        app,
      );
      httpsServer.listen(httpsPort, () => {
        logger.info(`HTTPS server listening on https://localhost:${httpsPort}`);
      });
    } else {
      logger.warn('HTTPS not started: missing SSL cert/key and self-signed generation failed.');
    }
  }
}
