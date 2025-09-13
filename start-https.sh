#!/bin/bash

# Start the fantasy football bot web server with HTTPS
echo "Starting Fantasy Football Bot Web Server with HTTPS..."
echo "Server will be available at: https://localhost:3000"
echo ""

# Check if certificates exist
if [ ! -f "config/certs/cert.pem" ] || [ ! -f "config/certs/key.pem" ]; then
    echo "SSL certificates not found. Creating self-signed certificates..."
    mkdir -p config/certs
    openssl req -x509 -newkey rsa:4096 -keyout config/certs/key.pem -out config/certs/cert.pem -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
    echo "Certificates created successfully!"
    echo ""
fi

# Start the server with HTTPS
ENABLE_HTTPS=1 SSL_CERT_PATH=config/certs/cert.pem SSL_KEY_PATH=config/certs/key.pem node dist/web/server.js

