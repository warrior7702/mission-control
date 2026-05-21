#!/bin/bash
# FBCA Mission Control Autostart
# Runs on user login (systemd user service)

cd /home/bnelms/.openclaw/workspace/mission-control

# Kill any existing instances
pkill -f "node api/server.js" 2>/dev/null
sleep 1

# Start server (background, nohup)
export HOME=/home/bnelms
nohup node api/server.js > /tmp/mission-control.log 2>&1 &

sleep 2

# Start ngrok tunnel
pkill -f "ngrok.*bobbot" 2>/dev/null
sleep 1
nohup ngrok http 3737 --url=bobbot.ngrok.app > /tmp/ngrok.log 2>&1 &

echo "$(date): Mission Control started" >> /tmp/mission-control.log
