#!/bin/sh
set -e

# Default envs
PORT=${PORT:-3000}
SSL_CERT_PATH=/app/config/certs/cert.pem
SSL_KEY_PATH=/app/config/certs/key.pem

# Ensure directories exist
mkdir -p "$(dirname "$SSL_CERT_PATH")" "$(dirname "$SSL_KEY_PATH")" /app/logs /app/.secure

# Generate self-signed certs if HTTPS enabled and certs missing
if [ ! -f "$SSL_CERT_PATH" ] || [ ! -f "$SSL_KEY_PATH" ]; then
  echo "[entrypoint] Generating self-signed TLS certs at $SSL_CERT_PATH and $SSL_KEY_PATH"
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$SSL_KEY_PATH" -out "$SSL_CERT_PATH" \
    -days 365 -subj "/C=US/ST=CA/L=Local/O=YahooFantasyAgent/OU=Dev/CN=localhost"
fi

echo "[entrypoint] Starting server (HTTPS=always, PORT=$PORT)"
exec "$@"
