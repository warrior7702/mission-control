# Mission Control — FULLY OPERATIONAL v2

**URL:** https://bobbot.ngrok.app  
**Status:** ✅ LIVE — systemd autostart enabled  
**Last Updated:** 2026-05-21

## Startup
```bash
systemctl --user start mission-control    # Start now
systemctl --user enable mission-control   # Autostart on login
systemctl --user status mission-control   # Check status
```

## What's Fixed (All Items from v1)

| # | Issue | Fix |
|---|-------|-----|
| 1 | **Not running** | Server + ngrok both running under systemd |
| 2 | **No autostart** | `mission-control.service` enabled, restarts on crash |
| 3 | **Door API 401** | Added `X-API-Key` header from `~/.fbca_door_api_key` |
| 4 | **Agent wrong path** | Points to `shared-brain/shared-knowledge.md` |
| 5 | **Schedule filtering** | Handles missing `isActive` gracefully |
| 6 | **Email shell escape hell** | Extracted to `scripts/count-unread-o365.py` |
| 7 | **Slow load** | 60-second cache on all endpoints |
| 8 | **Schedule create stub** | IMPLEMENTED — creates per-door, handles conflicts |
| 9 | **Cache busting** | `GET /api/clear-cache` endpoint added |

## Endpoint Status

| Endpoint | Method | Status | Notes |
|----------|--------|--------|-------|
| `/` | GET | ✅ | Dashboard HTML |
| `/api/dashboard` | GET | ✅ | All-in-one, cached |
| `/api/tickets` | GET | ✅ | 14 tickets, cached |
| `/api/approvals` | GET | ✅ | 12 pending, cached |
| `/api/schedules` | GET | ✅ | 7 today, auth fixed, cached |
| `/api/email` | GET | ✅ | 0 unread, cached |
| `/api/agents` | GET | ✅ | Empty (no shared-knowledge content) |
| `/api/health` | GET | ✅ | Stale (last check 2026-05-06) |
| `/api/clear-cache` | GET | ✅ | Bust all caches |
| `/api/tickets/:id/close` | POST | ✅ | Close + comment |
| `/api/approvals/:id/approve` | POST | ✅ | Approve with code/time |
| `/api/schedules/create` | POST | ✅ | Creates per door, handles conflicts |

## Known Data Issues (NOT Code Bugs)

| Issue | Why | Fix When |
|-------|-----|----------|
| Health shows "stale" | `.health-monitor-state.json` from May 6 | Run `scripts/token-health-monitor.py` to refresh |
| Agents empty | `shared-brain/shared-knowledge.md` has no entries | Add entries or remove widget |
| Schedule conflict error | Tried to create at same time as existing schedule | Correct behavior — prevents duplicates |

## API Usage Examples

### Create Door Schedule
```bash
curl -X POST https://bobbot.ngrok.app/api/schedules/create \
  -H "Content-Type: application/json" \
  -d '{
    "eventName": "Youth Bible Study",
    "doorIds": [26, 27],
    "startTime": "2026-05-21T19:00:00Z",
    "endTime": "2026-05-21T21:00:00Z",
    "code": "297312#"
  }'
```

### Clear Cache
```bash
curl https://bobbot.ngrok.app/api/clear-cache
```

### Close ClickUp Ticket
```bash
curl -X POST https://bobbot.ngrok.app/api/tickets/86ba1pwb4/close \
  -H "Content-Type: application/json" \
  -d '{"resolution": "Fixed mag lock wiring"}'
```

## Files
- Server: `mission-control/api/server.js`
- Start script: `mission-control/start.sh`
- Systemd: `~/.config/systemd/user/mission-control.service`
- Helper: `scripts/count-unread-o365.py`
