#!/bin/bash
# Mission Control Deploy Script
# Run this on Ubuntu after pulling new code

set -e

echo "🦦 Mission Control Deploy"
echo "========================="

cd "$(dirname "$0")"

# Pull latest
echo "→ Pulling latest code..."
git pull origin main || git pull origin master

# Install dependencies
echo "→ Installing dependencies..."
npm install 2>/dev/null || echo "(no new deps)"

# Restart services
echo "→ Restarting server..."
pkill -f "node api/server.js" 2>/dev/null || true
sleep 1

export HOME=/home/bnelms
nohup node api/server.js > /tmp/mission-control.log 2>&1 &
sleep 2

# Verify
echo "→ Verifying..."
if curl -s http://localhost:3737/health > /dev/null 2>&1; then
    echo "✅ Server is up on localhost:3737"
elif curl -s http://localhost:3737 > /dev/null 2>&1; then
    echo "✅ Server is up on localhost:3737"
else
    echo "⚠️ Server may not be responding yet (check /tmp/mission-control.log)"
fi

echo "→ Done!"
echo "   URL: https://bobbot.ngrok.app"
