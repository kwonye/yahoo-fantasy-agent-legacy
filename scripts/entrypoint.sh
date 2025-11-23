#!/bin/sh
set -e

# Default envs
PORT=${PORT:-3000}

# Ensure directories exist for runtime data
mkdir -p /app/config /app/logs /app/.secure

echo "[entrypoint] Starting server (HTTP, PORT=$PORT)"
exec "$@"
