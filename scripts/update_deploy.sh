#!/bin/bash
set -e

# Navigate to the project directory
cd "$(dirname "$0")/.."

echo "Syncing with the latest changes from origin/main..."

# Sync the local main branch with the remote origin/main
# This is equivalent to git pull origin main
gh repo sync -b main

echo "Repository synced. Restarting Docker containers..."

# Stop and remove the old containers
docker compose down

# Rebuild the containers
docker compose build

# Start the new containers in detached mode
docker compose up -d

echo "Deployment successful!"
