#!/usr/bin/env node
/**
 * FBCA Mission Control - Backend API Server
 * Aggregates data from ClickUp, PCO, Door Server, and Agents
 * v2 - Added: caching, door schedule creation, health refresh
 */

const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);
const app = express();
const PORT = 3737;
const WORKSPACE = process.env.HOME + '/.openclaw/workspace';
const CACHE_TTL = 60000; // 60 second cache

// ============================================================================
// SIMPLE MEMORY CACHE
// ============================================================================
const cache = new Map();

// ============================================================================
// AGENT ACTIVITY LOG
// ============================================================================
const AGENT_LOG_FILE = WORKSPACE + '/.agent-activity.json';

function loadAgentLog() {
  try {
    if (fs.existsSync(AGENT_LOG_FILE)) {
      return JSON.parse(fs.readFileSync(AGENT_LOG_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return {};
}

function saveAgentLog(log) {
  try {
    fs.writeFileSync(AGENT_LOG_FILE, JSON.stringify(log, null, 2));
  } catch (e) { console.error('Failed to save agent log:', e); }
}

function recordAgentActivity(agentId, data) {
  const log = loadAgentLog();
  if (!log[agentId]) {
    log[agentId] = { history: [] };
  }
  log[agentId].lastSeen = new Date().toISOString();
  log[agentId].status = data.status || 'unknown';
  log[agentId].currentTask = data.currentTask || 'Idle';
  log[agentId].capabilities = data.capabilities || [];
  log[agentId].instanceId = data.instanceId || 'unknown';
  
  // Keep last 50 entries
  log[agentId].history.unshift({
    timestamp: new Date().toISOString(),
    action: data.action || 'heartbeat',
    details: data.currentTask || 'Active'
  });
  if (log[agentId].history.length > 50) {
    log[agentId].history = log[agentId].history.slice(0, 50);
  }
  
  saveAgentLog(log);
}

function getAgentStatusV2() {
  const log = loadAgentLog();
  const now = Date.now();
  const agents = [];
  
  Object.entries(log).forEach(([agentId, data]) => {
    const lastSeen = data.lastSeen ? new Date(data.lastSeen).getTime() : 0;
    const minutesSince = Math.floor((now - lastSeen) / 60000);
    const isOnline = minutesSince < 5; // Consider offline after 5 minutes
    
    agents.push({
      agentId,
      name: agentId.charAt(0).toUpperCase() + agentId.slice(1),
      status: isOnline ? (data.status || 'online') : 'offline',
      lastSeen: data.lastSeen,
      minutesSince,
      currentTask: data.currentTask || 'Idle',
      capabilities: data.capabilities || [],
      instanceId: data.instanceId || 'unknown',
      history: (data.history || []).slice(0, 5) // Last 5 actions
    });
  });
  
  // Sort by online first, then by last seen
  agents.sort((a, b) => {
    if (a.status === 'offline' && b.status !== 'offline') return 1;
    if (a.status !== 'offline' && b.status === 'offline') return -1;
    return (b.lastSeen || 0) - (a.lastSeen || 0);
  });
  
  return { agents, total: agents.length };
}

function getCache(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

function clearCache() {
  cache.clear();
}

// ============================================================================
// MIDDLEWARE
// ============================================================================
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ============================================================================
// DATA AGGREGATORS
// ============================================================================

async function getClickUpTickets() {
  const cached = getCache('tickets');
  if (cached) return cached;

  try {
    const { stdout } = await execAsync(
      `cd ${WORKSPACE} && python3 scripts/clickup-tickets.py --json`,
      { timeout: 10000 }
    );
    const tickets = JSON.parse(stdout);

    const departments = { 'Unassigned': [], 'IT': [], 'Maintenance': [], 'Cleaning': [] };
    tickets.forEach(t => {
      const dept = t.department || 'Unassigned';
      (departments[dept] || departments['Unassigned']).push(t);
    });

    const result = { tickets, departments, total: tickets.length };
    setCache('tickets', result);
    return result;
  } catch (error) {
    return { error: error.message, tickets: [], departments: {}, total: 0 };
  }
}

async function getPCOApprovals() {
  const cached = getCache('approvals');
  if (cached) return cached;

  try {
    const { stdout } = await execAsync(
      `cd ${WORKSPACE} && python3 scripts/pco-approve.py list --json`,
      { timeout: 10000 }
    );
    const result = JSON.parse(stdout);
    setCache('approvals', result);
    return result;
  } catch (error) {
    return { error: error.message, approvals: [] };
  }
}

async function getDoorSchedules() {
  const cached = getCache('schedules');
  if (cached) return cached;

  try {
    const apiKey = fs.readFileSync(process.env.HOME + '/.fbca_door_api_key', 'utf8').trim();
    const response = await fetch('http://100.123.239.124:5002/api/schedules', {
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' }
    });
    const data = await response.json();

    const today = new Date().toISOString().split('T')[0];
    const todaySchedules = data.schedules.filter(s => {
      const schedDate = new Date(s.startTime).toISOString().split('T')[0];
      const active = s.isActive !== undefined ? s.isActive : true;
      return schedDate === today && active;
    });

    const result = { schedules: todaySchedules, totalToday: todaySchedules.length };
    setCache('schedules', result);
    return result;
  } catch (error) {
    return { error: error.message, schedules: [], totalToday: 0 };
  }
}

async function getEmailStatus() {
  const cached = getCache('email');
  if (cached) return cached;

  try {
    // Check O365 unread count via helper script
    const { stdout: o365Count } = await execAsync(
      `cd ${WORKSPACE} && python3 scripts/count-unread-o365.py`,
      { timeout: 10000 }
    );

    const result = { o365: parseInt(o365Count.trim()) || 0, gmail: 0 };
    setCache('email', result);
    return result;
  } catch (error) {
    return { error: error.message, o365: '?', gmail: 0 };
  }
}

async function getAgentStatus() {
  const cached = getCache('agents');
  if (cached) return cached;

  // Try v2 agent log first
  const v2 = getAgentStatusV2();
  if (v2.total > 0) {
    setCache('agents', v2);
    return v2;
  }

  // Fallback to shared knowledge markdown
  try {
    const knowledgeFile = WORKSPACE + '/shared-brain/shared-knowledge.md';
    if (!fs.existsSync(knowledgeFile)) {
      return { agents: [], message: 'No shared knowledge file' };
    }

    const sharedKnowledge = fs.readFileSync(knowledgeFile, 'utf8');
    const entries = [];
    const lines = sharedKnowledge.split('\n');

    for (let i = lines.length - 1; i >= 0 && entries.length < 5; i--) {
      if (lines[i].startsWith('## [')) {
        const match = lines[i].match(/\[(\d+:\d+)\] (.+?): (.+)/);
        if (match) {
          entries.push({ time: match[1], agent: match[2], title: match[3] });
        }
      }
    }

    const result = { agents: entries };
    setCache('agents', result);
    return result;
  } catch (error) {
    return { error: error.message, agents: [] };
  }
}

async function getSystemHealth() {
  const cached = getCache('health');
  if (cached) return cached;

  try {
    const stateFile = `${WORKSPACE}/.health-monitor-state.json`;
    if (!fs.existsSync(stateFile)) {
      return { status: 'no-state', lastCheck: null, issuesCount: 0, issues: [], message: 'Health monitor not initialized' };
    }

    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const lastCheck = state.last_run;
    const hoursSince = lastCheck ? (Date.now() - new Date(lastCheck).getTime()) / 3600000 : null;
    const isStale = hoursSince > 24;

    const result = {
      status: isStale ? 'stale' : 'ok',
      lastCheck: lastCheck,
      hoursSince: hoursSince ? Math.round(hoursSince * 10) / 10 : null,
      issuesCount: state.issues_today?.length || 0,
      issues: state.issues_today || [],
      stale: isStale
    };
    setCache('health', result);
    return result;
  } catch (error) {
    return { status: 'error', error: error.message, issuesCount: 0, issues: [] };
  }
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

// Cache-busting endpoint
app.get('/api/clear-cache', (req, res) => {
  clearCache();
  res.json({ cleared: true });
});

// Dashboard data (all-in-one, from cache if fresh)
app.get('/api/dashboard', async (req, res) => {
  try {
    const [tickets, approvals, schedules, email, agents, health] = await Promise.all([
      getClickUpTickets(),
      getPCOApprovals(),
      getDoorSchedules(),
      getEmailStatus(),
      getAgentStatus(),
      getSystemHealth()
    ]);

    res.json({
      tickets,
      approvals,
      schedules,
      email,
      agents,
      health,
      timestamp: new Date().toISOString(),
      cache_info: { ttl_ms: CACHE_TTL, fresh: true }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tickets', async (req, res) => { res.json(await getClickUpTickets()); });
app.get('/api/approvals', async (req, res) => { res.json(await getPCOApprovals()); });
app.get('/api/schedules', async (req, res) => { res.json(await getDoorSchedules()); });
app.get('/api/email', async (req, res) => { res.json(await getEmailStatus()); });
app.get('/api/agents', async (req, res) => { res.json(await getAgentStatus()); });
app.get('/api/health', async (req, res) => { res.json(await getSystemHealth()); });

// Agent heartbeat / activity endpoint
app.post('/api/agent-activity', (req, res) => {
  const { agentId, status, currentTask, capabilities, instanceId, action } = req.body;
  if (!agentId) {
    return res.status(400).json({ error: 'agentId required' });
  }
  recordAgentActivity(agentId, { status, currentTask, capabilities, instanceId, action });
  res.json({ success: true, recorded: agentId });
});

app.get('/api/monthly-stats', async (req, res) => {
  try {
    const { stdout } = await execAsync(
      `cd ${WORKSPACE} && python3 scripts/clickup-monthly-stats.py --json 2>/dev/null || echo '{"total_closed":0}'`
    );
    res.json(JSON.parse(stdout));
  } catch (error) {
    res.json({ total_closed: 0, by_department: {}, error: error.message });
  }
});

// ============================================================================
// ACTIONS
// ============================================================================

// Close ClickUp ticket
app.post('/api/tickets/:id/close', async (req, res) => {
  const { id } = req.params;
  const { resolution } = req.body;

  try {
    await execAsync(
      `cd ${WORKSPACE} && python3 -c "
import requests, os

token = None
with open('${WORKSPACE}/.env') as f:
    for line in f:
        if line.startswith('CLICKUP_API_TOKEN='):
            token = line.split('=', 1)[1].strip()

headers = {'Authorization': token}
r = requests.put(f'https://api.clickup.com/api/v2/task/{id}',
    headers=headers, json={'status': 'resolved'})
if r.status_code == 200:
    if '${resolution}':
        requests.post(f'https://api.clickup.com/api/v2/task/{id}/comment',
            headers=headers, json={'comment_text': 'Resolution: ${resolution}'})
print('OK')
else:
    print('FAIL', r.status_code)
"`,
      { timeout: 10000 }
    );

    clearCache(); // Bust ticket cache
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Approve PCO request
app.post('/api/approvals/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { code, time } = req.body;

  try {
    await execAsync(
      `cd ${WORKSPACE} && python3 scripts/pco-approve.py approve ${id} "${code}" "${time}"`,
      { timeout: 15000 }
    );
    clearCache();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create door schedule — IMPLEMENTED (individual per-door)
app.post('/api/schedules/create', async (req, res) => {
  const { eventName, doorIds, startTime, endTime, code } = req.body;

  if (!eventName || !doorIds || !startTime || !endTime) {
    return res.status(400).json({ error: 'Missing required fields: eventName, doorIds, startTime, endTime' });
  }

  try {
    const apiKey = fs.readFileSync(process.env.HOME + '/.fbca_door_api_key', 'utf8').trim();
    const created = [];
    const errors = [];

    for (const doorId of doorIds) {
      const schedule = {
        doorId: parseInt(doorId),
        startTime,
        endTime,
        name: eventName,
        description: code ? `Code: ${code}` : 'Created from Mission Control',
        isOneTime: false,
        isActive: true,
        source: 'Mission Control'
      };

      const response = await fetch('http://100.123.239.124:5002/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify(schedule)
      });

      const data = await response.json();

      if (response.ok) {
        created.push({ doorId, id: data.scheduleID });
      } else {
        errors.push({ doorId, error: data.message || `HTTP ${response.status}` });
      }
    }

    clearCache();

    if (errors.length > 0 && created.length === 0) {
      res.status(500).json({ success: false, error: 'All door schedule creations failed', errors });
    } else if (errors.length > 0) {
      res.json({ success: true, partial: true, created, errors, totalCreated: created.length });
    } else {
      res.json({ success: true, created, totalCreated: created.length });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// DEPLOY WEBHOOK
// ============================================================================

app.post('/webhook/deploy', (req, res) => {
  const { ref, sha } = req.body || {};
  console.log(`🔄 Deploy webhook triggered — ref: ${ref}, sha: ${sha?.slice(0, 7)}`);
  
  res.json({ received: true, pulling: true });
  
  // Pull and restart in background
  const deployScript = path.join(__dirname, '../deploy.sh');
  exec(`${deployScript} > /tmp/deploy.log 2>&1 &`, (err) => {
    if (err) console.error('Deploy failed:', err);
  });
});

// ============================================================================
// SERVER START
// ============================================================================

app.listen(PORT, () => {
  console.log(`🚀 Mission Control API v2 running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔧 API: http://localhost:${PORT}/api/dashboard`);
  console.log(`⏱️  Cache TTL: ${CACHE_TTL}ms`);
});
