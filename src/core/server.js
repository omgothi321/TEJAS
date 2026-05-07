'use strict';

const http            = require('http');
const path            = require('path');
const fs              = require('fs-extra');
const { WebSocketServer } = require('ws');
const MemoryManager   = require('../core/memory');
const SecurityManager = require('../security/security');
const AIEngine        = require('../core/ai');
const AgentRouter     = require('../agents/router');

// ─── DASHBOARD SERVER ─────────────────────────────────────────────────────────
class DashboardServer {
  constructor(options = {}) {
    this.port     = options.port || 4000;
    this.cwd      = options.cwd || process.cwd();
    this.memory   = new MemoryManager(this.cwd);
    this.security = new SecurityManager(path.join(this.cwd, '.tejas'));
    this.clients  = new Set(); // WebSocket clients
    this.server   = null;
    this.wss      = null;
  }

  // ── START ─────────────────────────────────────────────────────────────────
  async start() {
    await this.memory.load?.();

    const { exists, token } = await this.security.getOrCreateToken();
    if (!exists) {
      console.log('\n  🔑 Dashboard token: ' + token);
      console.log('  Save this — you need it to access the dashboard.\n');
    }

    this.server = http.createServer((req, res) => this._handleRequest(req, res));
    this.wss    = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws, req) => this._handleWS(ws, req));

    this.server.listen(this.port, '127.0.0.1', () => {
      console.log(`  ✓ Dashboard running at http://127.0.0.1:${this.port}`);
    });

    // Broadcast memory updates every 5 seconds
    setInterval(() => this._broadcastStats(), 5000);

    return token;
  }

  // ── HTTP REQUEST HANDLER ──────────────────────────────────────────────────
  async _handleRequest(req, res) {
    const url    = req.url || '/';
    const method = req.method || 'GET';

    // CORS — localhost only
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:' + this.port);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // ── Serve dashboard UI ──
    if (url === '/' || url === '/index.html') {
      const html = await this._getDashboardHTML();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    // ── API routes (all require auth) ──
    if (url.startsWith('/api/')) {
      await this._handleAPI(req, res, url, method);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  }

  // ── AUTH MIDDLEWARE ───────────────────────────────────────────────────────
  async _isAuthed(req) {
    const auth  = req.headers['authorization'] || '';
    const token = auth.replace('Bearer ', '').trim();
    // Also check query param for WebSocket
    if (!token) {
      const qs    = new URLSearchParams(req.url?.split('?')[1] || '');
      return this.security.validateToken(qs.get('token') || '');
    }
    return this.security.validateToken(token);
  }

  // ── API HANDLER ───────────────────────────────────────────────────────────
  async _handleAPI(req, res, url, method) {
    // Auth check for all API routes
    if (!await this._isAuthed(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      await this.security.audit({ event: 'auth_fail', url, ip: req.socket.remoteAddress });
      return;
    }

    const sendJSON = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(this.security.sanitizeForDashboard(JSON.stringify(data)));
    };

    try {
      // GET /api/stats
      if (url === '/api/stats' && method === 'GET') {
        const mem   = await this.memory.read();
        const graph = await this.memory.getGraphStats();
        sendJSON({ memory: mem.stats, graph, project: mem.project, world: mem.world_model });
        return;
      }

      // GET /api/tasks
      if (url === '/api/tasks' && method === 'GET') {
        const mem = await this.memory.read();
        sendJSON({ tasks: mem.agents.history.slice(0, 20) });
        return;
      }

      // GET /api/graph
      if (url === '/api/graph' && method === 'GET') {
        const stats   = await this.memory.getGraphStats();
        const tree    = await this.memory.graphVisualize();
        const patterns = await this.memory.findPatterns();
        sendJSON({ stats, tree, patterns });
        return;
      }

      // GET /api/graph/nodes
      if (url === '/api/graph/nodes' && method === 'GET') {
        await this.memory.graph.load();
        const g = this.memory.graph._graph;
        sendJSON({
          nodes: Object.values(g.nodes).slice(0, 100),
          edges: g.edges.slice(0, 200)
        });
        return;
      }

      // GET /api/agents
      if (url === '/api/agents' && method === 'GET') {
        const config = await this.memory.readConfig();
        const ai     = new AIEngine(config);
        const router = new AgentRouter(ai, this.memory);
        sendJSON({ agents: router.getAgentList() });
        return;
      }

      // GET /api/audit
      if (url === '/api/audit' && method === 'GET') {
        const log = await this.security.getAuditLog(30);
        sendJSON({ log });
        return;
      }

      // POST /api/run
      if (url === '/api/run' && method === 'POST') {
        const body = await this._readBody(req);
        const { task } = JSON.parse(body);

        // Validate task
        const validation = this.security.validateTask(task);
        if (!validation.valid) {
          sendJSON({ error: validation.reason }, 400);
          return;
        }

        // Rate limit
        const rate = this.security.checkRateLimit('dashboard');
        if (!rate.allowed) {
          sendJSON({ error: rate.reason }, 429);
          return;
        }

        // Audit
        await this.security.audit({ event: 'task_run', task, source: 'dashboard' });

        // Run task (non-blocking — result comes via WebSocket)
        this._runTaskAsync(task);

        sendJSON({ status: 'running', message: 'Task started. Watch live feed.' });
        return;
      }

      // GET /api/memory/search?q=query
      if (url.startsWith('/api/memory/search') && method === 'GET') {
        const qs    = new URLSearchParams(url.split('?')[1] || '');
        const query = qs.get('q') || '';
        const results = await this.memory.graphSearch(query);
        sendJSON({ results });
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));

    } catch (err) {
      sendJSON({ error: err.message }, 500);
    }
  }

  // ── RUN TASK ASYNC (broadcasts via WebSocket) ─────────────────────────────
  async _runTaskAsync(task) {
    this._broadcast({ type: 'task_start', task, ts: new Date().toISOString() });

    try {
      const config  = await this.memory.readConfig();
      const ai      = new AIEngine(config);
      const router  = new AgentRouter(ai, this.memory);
      const context = await this.memory.getContextSummary(task);
      const routing = await router.route(task, {}, context);

      if (!routing.useNativeExecutor && routing.result) {
        const r = routing.result;
        this._broadcast({
          type:    r.success ? 'task_complete' : 'task_error',
          task,
          agent:   routing.agent,
          output:  this.security.sanitizeForDashboard(r.output || ''),
          success: r.success,
          error:   r.error,
          ts:      new Date().toISOString()
        });

        await this.memory.logTask({
          task, agent: routing.agent, steps: 1,
          success: r.success, duration_ms: 0,
          error_message: r.error
        });
      } else {
        this._broadcast({
          type:    'task_info',
          task,
          message: 'Task needs shell execution — run from CLI: tejas run "' + task + '"',
          ts:      new Date().toISOString()
        });
      }
    } catch (err) {
      this._broadcast({ type: 'task_error', task, error: err.message, ts: new Date().toISOString() });
    }

    // Push updated stats after task
    setTimeout(() => this._broadcastStats(), 500);
  }

  // ── WEBSOCKET HANDLER ─────────────────────────────────────────────────────
  async _handleWS(ws, req) {
    // Auth via query param
    const qs    = new URLSearchParams(req.url?.split('?')[1] || '');
    const token = qs.get('token') || '';

    if (!await this.security.validateToken(token)) {
      ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
      ws.close();
      return;
    }

    this.clients.add(ws);
    ws.send(JSON.stringify({ type: 'connected', message: 'Tejas Dashboard connected' }));

    // Send initial stats
    this._broadcastStats();

    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
  }

  // ── BROADCAST ─────────────────────────────────────────────────────────────
  _broadcast(data) {
    const msg = JSON.stringify(data);
    for (const client of this.clients) {
      try { client.send(msg); } catch {}
    }
  }

  async _broadcastStats() {
    try {
      const mem   = await this.memory.read();
      const graph = await this.memory.getGraphStats();
      this._broadcast({
        type:  'stats_update',
        stats: { memory: mem.stats, graph }
      });
    } catch (e) {
      if (this.verbose) console.warn('[Dashboard] Stats broadcast failed:', e.message);
    }
  }

  // ── READ REQUEST BODY ─────────────────────────────────────────────────────
  _readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 10000) reject(new Error('Body too large'));
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  // ── STOP ──────────────────────────────────────────────────────────────────
  stop() {
    this.wss?.close();
    this.server?.close();
  }

  // ── DASHBOARD HTML ────────────────────────────────────────────────────────
  async _getDashboardHTML() {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    if (await fs.pathExists(htmlPath)) {
      return fs.readFile(htmlPath, 'utf8');
    }
    return this._getInlineHTML();
  }

  _getInlineHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tejas Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0a0a0f; --surface: #12121a; --card: #1a1a26;
    --border: #2a2a3d; --accent: #7c3aed; --accent2: #06b6d4;
    --green: #10b981; --red: #ef4444; --yellow: #f59e0b;
    --text: #e2e8f0; --muted: #64748b;
  }
  body { background: var(--bg); color: var(--text); font-family: 'Courier New', monospace; min-height: 100vh; }

  /* ── HEADER ── */
  .header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 16px 24px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .logo { font-size: 20px; font-weight: bold; color: var(--accent); letter-spacing: 2px; }
  .logo span { color: var(--accent2); }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); display: inline-block; margin-right: 8px; animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

  /* ── AUTH SCREEN ── */
  .auth-screen {
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; flex-direction: column; gap: 20px;
  }
  .auth-box {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 12px; padding: 40px; width: 400px; text-align: center;
  }
  .auth-box h2 { color: var(--accent); margin-bottom: 8px; font-size: 24px; }
  .auth-box p  { color: var(--muted); margin-bottom: 24px; font-size: 14px; }
  input {
    width: 100%; padding: 12px 16px; background: var(--surface);
    border: 1px solid var(--border); border-radius: 8px;
    color: var(--text); font-family: monospace; font-size: 14px; margin-bottom: 16px;
  }
  input:focus { outline: none; border-color: var(--accent); }
  button {
    width: 100%; padding: 12px; background: var(--accent);
    border: none; border-radius: 8px; color: white;
    font-family: monospace; font-size: 14px; cursor: pointer;
    transition: background 0.2s;
  }
  button:hover { background: #6d28d9; }
  .error-msg { color: var(--red); font-size: 12px; margin-top: 8px; }

  /* ── MAIN LAYOUT ── */
  .main { display: none; }
  .main.visible { display: block; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; padding: 24px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 0 24px 24px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; padding: 0 24px 24px; }

  /* ── CARDS ── */
  .card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 12px; padding: 20px;
  }
  .card-title { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .card-value { font-size: 32px; font-weight: bold; color: var(--accent); }
  .card-sub   { font-size: 12px; color: var(--muted); margin-top: 4px; }

  /* ── TASK INPUT ── */
  .task-bar { padding: 0 24px 24px; }
  .task-input-row { display: flex; gap: 12px; }
  .task-input-row input { margin: 0; flex: 1; }
  .task-input-row button { width: auto; padding: 12px 24px; }

  /* ── LIVE FEED ── */
  .feed {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; height: 200px; overflow-y: auto;
    padding: 12px; font-size: 12px;
  }
  .feed-entry { padding: 4px 0; border-bottom: 1px solid var(--border); }
  .feed-entry .ts    { color: var(--muted); }
  .feed-entry .agent { color: var(--accent2); }
  .feed-entry.success .icon { color: var(--green); }
  .feed-entry.error   .icon { color: var(--red); }
  .feed-entry.info    .icon { color: var(--yellow); }

  /* ── AGENTS ── */
  .agent-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .agent-item {
    display: flex; align-items: center; gap: 10px;
    padding: 10px; background: var(--surface);
    border: 1px solid var(--border); border-radius: 8px;
  }
  .agent-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .agent-dot.active  { background: var(--green); }
  .agent-dot.planned { background: var(--yellow); }
  .agent-name { font-size: 13px; font-weight: bold; }
  .agent-desc { font-size: 11px; color: var(--muted); }

  /* ── GRAPH ── */
  #graph-canvas { width: 100%; height: 300px; background: var(--surface); border-radius: 8px; }
  .graph-legend { display: flex; gap: 16px; margin-top: 8px; flex-wrap: wrap; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }
  .legend-dot  { width: 10px; height: 10px; border-radius: 50%; }

  /* ── TASKS LIST ── */
  .task-list { display: flex; flex-direction: column; gap: 6px; }
  .task-item {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 10px; background: var(--surface);
    border: 1px solid var(--border); border-radius: 8px; font-size: 12px;
  }
  .task-item .badge {
    padding: 2px 8px; border-radius: 4px; font-size: 10px;
    flex-shrink: 0; font-weight: bold;
  }
  .badge.success { background: rgba(16,185,129,0.2); color: var(--green); }
  .badge.failed  { background: rgba(239,68,68,0.2);  color: var(--red); }
  .task-text     { flex: 1; color: var(--text); }
  .task-meta     { color: var(--muted); font-size: 10px; }

  /* ── PATTERNS ── */
  .pattern-item {
    padding: 10px; background: var(--surface);
    border-left: 3px solid var(--accent);
    border-radius: 4px; font-size: 12px; margin-bottom: 8px;
  }
  .pattern-item .pattern-label { color: var(--accent2); font-weight: bold; }
  .pattern-item .pattern-tip   { color: var(--muted); margin-top: 4px; }

  /* ── SEARCH ── */
  .search-results { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
  .search-item {
    padding: 8px 12px; background: var(--surface);
    border: 1px solid var(--border); border-radius: 6px; font-size: 12px;
  }
  .search-item .node-type  { color: var(--accent2); font-size: 10px; }
  .search-item .node-label { color: var(--text); }
  .search-item .node-score { color: var(--yellow); font-size: 10px; float: right; }

  /* ── SCROLLBAR ── */
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  h3 { font-size: 14px; color: var(--text); margin-bottom: 12px; }
</style>
</head>
<body>

<!-- AUTH SCREEN -->
<div class="auth-screen" id="auth-screen">
  <div class="auth-box">
    <h2>⬡ TEJAS</h2>
    <p>Tejas — Secure Access</p>
    <input type="password" id="token-input" placeholder="Enter dashboard token..." />
    <button onclick="authenticate()">Access Dashboard</button>
    <div class="error-msg" id="auth-error"></div>
    <p style="margin-top:16px;font-size:11px;color:var(--muted)">
      Token was shown when you ran: tejas dashboard
    </p>
  </div>
</div>

<!-- MAIN DASHBOARD -->
<div class="main" id="main">

  <div class="header">
    <div class="logo">⬡ TEJAS</div>
    <div style="display:flex;align-items:center;gap:16px">
      <span style="font-size:12px;color:var(--muted)" id="project-name">—</span>
      <span><span class="status-dot"></span><span style="font-size:12px" id="conn-status">Connecting...</span></span>
    </div>
  </div>

  <!-- STATS CARDS -->
  <div class="grid">
    <div class="card">
      <div class="card-title">Tasks Run</div>
      <div class="card-value" id="stat-tasks">0</div>
      <div class="card-sub">total executions</div>
    </div>
    <div class="card">
      <div class="card-title">Graph Nodes</div>
      <div class="card-value" id="stat-nodes">0</div>
      <div class="card-sub">knowledge entities</div>
    </div>
    <div class="card">
      <div class="card-title">Graph Edges</div>
      <div class="card-value" id="stat-edges">0</div>
      <div class="card-sub">relationships</div>
    </div>
    <div class="card">
      <div class="card-title">Patterns</div>
      <div class="card-value" id="stat-patterns">0</div>
      <div class="card-sub">learned workflows</div>
    </div>
  </div>

  <!-- TASK INPUT -->
  <div class="task-bar">
    <div class="task-input-row">
      <input type="text" id="task-input" placeholder="Run a task from the dashboard... e.g. 'search latest AI news'" onkeydown="if(event.key==='Enter')runTask()" />
      <button onclick="runTask()">▶ Execute</button>
    </div>
  </div>

  <!-- LIVE FEED + AGENTS -->
  <div class="grid-2">
    <div class="card">
      <h3>Live Feed</h3>
      <div class="feed" id="live-feed">
        <div class="feed-entry info"><span class="icon">◈ </span><span class="ts">${new Date().toLocaleTimeString()} </span>Dashboard connected</div>
      </div>
    </div>
    <div class="card">
      <h3>Agents</h3>
      <div class="agent-grid" id="agent-grid">
        <!-- populated by JS -->
      </div>
    </div>
  </div>

  <!-- GRAPH + TASKS -->
  <div class="grid-2">
    <div class="card">
      <h3>Knowledge Graph</h3>
      <canvas id="graph-canvas"></canvas>
      <div class="graph-legend">
        <div class="legend-item"><div class="legend-dot" style="background:#7c3aed"></div>task</div>
        <div class="legend-item"><div class="legend-dot" style="background:#06b6d4"></div>entity</div>
        <div class="legend-item"><div class="legend-dot" style="background:#10b981"></div>command</div>
        <div class="legend-item"><div class="legend-dot" style="background:#f59e0b"></div>workflow</div>
        <div class="legend-item"><div class="legend-dot" style="background:#ef4444"></div>error</div>
      </div>
    </div>
    <div class="card">
      <h3>Recent Tasks</h3>
      <div class="task-list" id="task-list">
        <div style="color:var(--muted);font-size:12px">No tasks yet — run something!</div>
      </div>
    </div>
  </div>

  <!-- PATTERNS + SEARCH -->
  <div class="grid-2" style="padding-bottom:40px">
    <div class="card">
      <h3>Detected Patterns</h3>
      <div id="patterns-list">
        <div style="color:var(--muted);font-size:12px">Run tasks to detect patterns...</div>
      </div>
    </div>
    <div class="card">
      <h3>Memory Search</h3>
      <div style="display:flex;gap:8px">
        <input type="text" id="search-input" placeholder="Search knowledge graph..." style="margin:0;flex:1" onkeydown="if(event.key==='Enter')searchMemory()" />
        <button onclick="searchMemory()" style="width:auto;padding:10px 16px">Search</button>
      </div>
      <div class="search-results" id="search-results"></div>
    </div>
  </div>


  <!-- VOICE INTERFACE -->
  <div class="grid-2" style="padding: 0 24px 40px">
    <div class="card" style="border-color: #7c3aed44">
      <h3>🎙️ TEJAS Voice Interface</h3>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;gap:8px;align-items:center">
          <button id="voice-btn" onclick="toggleVoice()" style="width:auto;padding:10px 20px;background:#7c3aed">
            🎤 Start Listening
          </button>
          <span id="voice-status" style="font-size:12px;color:var(--muted)">Click to activate browser voice</span>
        </div>
        <div id="voice-transcript" style="padding:10px;background:var(--surface);border-radius:6px;font-size:12px;color:var(--muted);min-height:40px">
          Say something after clicking Start...
        </div>
        <div id="voice-response" style="padding:10px;background:var(--surface);border-radius:6px;font-size:12px;color:var(--text);min-height:40px;border-left:2px solid #7c3aed;display:none">
        </div>
      </div>
    </div>
    <div class="card">
      <h3>🔊 TTS — Tejas Speaks</h3>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;gap:8px">
          <input type="text" id="tts-input" placeholder="Type something for Tejas to say..." style="margin:0;flex:1" onkeydown="if(event.key===\'Enter\')speakText()" />
          <button onclick="speakText()" style="width:auto;padding:10px 16px">Speak</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button onclick="speakText(\'Tejas online. All systems operational.\')" style="width:auto;padding:6px 12px;font-size:11px;background:var(--surface);border:1px solid var(--border)">Test Voice</button>
          <button onclick="speakStatus()" style="width:auto;padding:6px 12px;font-size:11px;background:var(--surface);border:1px solid var(--border)">Speak Status</button>
        </div>
        <div style="font-size:11px;color:var(--muted);padding:8px;background:var(--surface);border-radius:6px">
          💡 For CLI voice: <span style="color:var(--accent2)">tejas voice</span> (REPL) or <span style="color:var(--accent2)">tejas voice --jarvis</span> (wake word)
        </div>
      </div>
    </div>
  </div>

</div><!-- /main -->

<script>
// ── STATE ────────────────────────────────────────────────────────────────────
let TOKEN   = '';
let ws      = null;
let graphData = { nodes: [], edges: [] };

// ── AUTH ─────────────────────────────────────────────────────────────────────
async function authenticate() {
  const token = document.getElementById('token-input').value.trim();
  if (!token) return;

  const res = await fetch('/api/stats', {
    headers: { 'Authorization': 'Bearer ' + token }
  });

  if (res.ok) {
    TOKEN = token;
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('main').classList.add('visible');
    initDashboard();
  } else {
    document.getElementById('auth-error').textContent = 'Invalid token. Check terminal.';
  }
}

// ── INIT ─────────────────────────────────────────────────────────────────────
async function initDashboard() {
  connectWS();
  await loadStats();
  await loadTasks();
  await loadAgents();
  await loadGraph();
  await loadPatterns();
  setInterval(loadStats, 10000);
  setInterval(loadTasks, 15000);
}

// ── WEBSOCKET ─────────────────────────────────────────────────────────────────
function connectWS() {
  ws = new WebSocket('ws://127.0.0.1:${this.port || 4000}?token=' + TOKEN);

  ws.onopen = () => {
    document.getElementById('conn-status').textContent = 'Live';
    document.getElementById('conn-status').style.color = '#10b981';
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    handleWSMessage(msg);
  };

  ws.onclose = () => {
    document.getElementById('conn-status').textContent = 'Disconnected';
    document.getElementById('conn-status').style.color = '#ef4444';
    setTimeout(connectWS, 3000);
  };
}

function handleWSMessage(msg) {
  if (msg.type === 'stats_update') {
    updateStatCards(msg.stats);
    return;
  }
  if (msg.type === 'task_start') {
    addFeedEntry('info', msg.ts, 'system', '▶ Running: ' + msg.task);
    return;
  }
  if (msg.type === 'task_complete') {
    addFeedEntry('success', msg.ts, msg.agent, '✓ ' + msg.task);
    if (msg.output) addFeedEntry('info', msg.ts, msg.agent, msg.output.slice(0, 200));
    loadTasks();
    loadGraph();
    return;
  }
  if (msg.type === 'task_error') {
    addFeedEntry('error', msg.ts, 'system', '✗ ' + (msg.error || 'Task failed'));
    return;
  }
  if (msg.type === 'task_info') {
    addFeedEntry('info', msg.ts, 'system', msg.message);
    return;
  }
}

// ── LOAD FUNCTIONS ────────────────────────────────────────────────────────────
async function api(path) {
  const res = await fetch(path, { headers: { 'Authorization': 'Bearer ' + TOKEN } });
  return res.json();
}

async function loadStats() {
  const data = await api('/api/stats');
  if (data.error) return;
  updateStatCards({ memory: data.memory, graph: data.graph });
  if (data.project?.name) document.getElementById('project-name').textContent = data.project.name;
}

function updateStatCards(stats) {
  if (stats.memory) {
    document.getElementById('stat-tasks').textContent    = stats.memory.tasks_run || 0;
    document.getElementById('stat-patterns').textContent = stats.memory.patterns_learned || 0;
  }
  if (stats.graph) {
    document.getElementById('stat-nodes').textContent = stats.graph.total_nodes || 0;
    document.getElementById('stat-edges').textContent = stats.graph.total_edges || 0;
  }
}

async function loadTasks() {
  const data = await api('/api/tasks');
  if (!data.tasks || data.tasks.length === 0) return;
  const list = document.getElementById('task-list');
  <script>
  function escHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  ...
    list.innerHTML = data.tasks.slice(0, 8).map(t => \`
      <div class="task-item">
        <span class="badge \${t.success ? 'success' : 'failed'}">\${t.success ? '✓' : '✗'}</span>
        <div>
          <div class="task-text">\${escHtml(t.task || '—')}</div>
          <div class="task-meta">\${escHtml(t.agent || '—')} · \${t.timestamp ? t.timestamp.split('T')[0] : '—'}</div>
        </div>
      </div>

async function loadAgents() {
  const data = await api('/api/agents');
  if (!data.agents) return;
  document.getElementById('agent-grid').innerHTML = data.agents.map(a => `
    <div class="agent-item">
      <div class="agent-dot ${escHtml(a.status || '')}"></div>
      <div>
        <div class="agent-name">${escHtml(a.name || '')}</div>
        <div class="agent-desc">${escHtml(a.description || '')}</div>
      </div>
    </div>
  `).join('');
}

async function loadGraph() {
  const data = await api('/api/graph/nodes');
  if (!data.nodes) return;
  graphData = { nodes: data.nodes, edges: data.edges };
  renderGraph();
}

async function loadPatterns() {
  const data = await api('/api/graph');
  if (!data.patterns) return;
  const el = document.getElementById('patterns-list');
  if (data.patterns.length === 0) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px">No patterns yet — keep using Tejas!</div>';
    return;
  }
  el.innerHTML = data.patterns.map(p => `
    <div class="pattern-item">
      <div class="pattern-label">${escHtml((p.type || '').replace('_', ' '))} — ${escHtml(String(p.count || 0))}×</div>
      <div>${escHtml(p.label || '')}</div>
      <div class="pattern-tip">💡 ${escHtml(p.suggestion || '')}</div>
    </div>
  `).join('');
}

// ── RUN TASK ──────────────────────────────────────────────────────────────────
async function runTask() {
  const task = document.getElementById('task-input').value.trim();
  if (!task) return;
  document.getElementById('task-input').value = '';

  const res = await fetch('/api/run', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ task })
  });
  const data = await res.json();
  if (data.error) addFeedEntry('error', new Date().toISOString(), 'system', data.error);
}

// ── MEMORY SEARCH ─────────────────────────────────────────────────────────────
async function searchMemory() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  const data = await api('/api/memory/search?q=' + encodeURIComponent(q));
  const el   = document.getElementById('search-results');
  if (!data.results || data.results.length === 0) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px">No results found.</div>';
    return;
  }
  el.innerHTML = data.results.slice(0, 6).map(r => `
    <div class="search-item">
      <span class="node-score">★ ${(r.relevance_score||0).toFixed(1)}</span>
      <div class="node-type">${escHtml(r.type || '')}</div>
      <div class="node-label">${escHtml(r.label || '')}</div>
    </div>
  `).join('');
}

// ── LIVE FEED ─────────────────────────────────────────────────────────────────
function addFeedEntry(type, ts, agent, message) {
  const feed = document.getElementById('live-feed');
  const time = ts ? new Date(ts).toLocaleTimeString() : new Date().toLocaleTimeString();
  const div  = document.createElement('div');
  div.className = 'feed-entry ' + type;
  div.innerHTML = `<span class="ts">${escHtml(time)} </span><span class="agent">[${escHtml(agent || '')}] </span>${escHtml(message.slice(0,150))}`;
  feed.insertBefore(div, feed.firstChild);
  if (feed.children.length > 50) feed.removeChild(feed.lastChild);
}

// ── GRAPH VISUALIZATION ───────────────────────────────────────────────────────
function renderGraph() {
  const canvas = document.getElementById('graph-canvas');
  const ctx    = canvas.getContext('2d');
  const W = canvas.width  = canvas.offsetWidth;
  const H = canvas.height = canvas.offsetHeight;

  ctx.clearRect(0, 0, W, H);

  const colors = {
    task:       '#7c3aed', entity: '#06b6d4',
    command:    '#10b981', workflow: '#f59e0b',
    error:      '#ef4444', fact: '#8b5cf6',
    preference: '#ec4899', note: '#6366f1'
  };

  const nodes = graphData.nodes.slice(0, 40);
  if (nodes.length === 0) {
    ctx.fillStyle = '#64748b';
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Run tasks to build the knowledge graph', W/2, H/2);
    return;
  }

  // Simple force-directed-ish layout using circular + random positions
  const positions = {};
  const cx = W / 2, cy = H / 2;
  const r  = Math.min(W, H) * 0.38;

  nodes.forEach((node, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI;
    const jitter = (Math.random() - 0.5) * r * 0.4;
    positions[node.id] = {
      x: cx + Math.cos(angle) * (r + jitter),
      y: cy + Math.sin(angle) * (r * 0.7 + jitter),
      node
    };
  });

  // Draw edges
  ctx.strokeStyle = '#2a2a3d';
  ctx.lineWidth   = 1;
  for (const edge of graphData.edges.slice(0, 80)) {
    const from = positions[edge.from];
    const to   = positions[edge.to];
    if (!from || !to) continue;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  // Draw nodes
  for (const { x, y, node } of Object.values(positions)) {
    const color  = colors[node.type] || '#7c3aed';
    const radius = 5 + Math.min((node.use_count || 1) * 1.5, 10);

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color + '33';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Label
    ctx.fillStyle  = '#e2e8f0';
    ctx.font       = '9px monospace';
    ctx.textAlign  = 'center';
    const label    = node.label.slice(0, 16);
    ctx.fillText(label, x, y + radius + 11);
  }
}


// ── VOICE INTERFACE (Web Speech API) ─────────────────────────────────────────
let recognition = null;
let voiceActive = false;
let synth = window.speechSynthesis;

function toggleVoice() {
  if (voiceActive) {
    stopVoice();
  } else {
    startVoice();
  }
}

function startVoice() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    document.getElementById('voice-status').textContent = 'Browser does not support voice (use Chrome/Edge)';
    return;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous    = false;
  recognition.interimResults = true;
  recognition.lang          = 'en-US';

  recognition.onstart = () => {
    voiceActive = true;
    document.getElementById('voice-btn').textContent    = '⏹ Stop';
    document.getElementById('voice-btn').style.background = '#ef4444';
    document.getElementById('voice-status').textContent = '🔴 Listening...';
    document.getElementById('voice-transcript').textContent = 'Speak now...';
    document.getElementById('voice-transcript').style.color = 'var(--text)';
  };

  recognition.onresult = (event) => {
    let interim = '';
    let final   = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        final += event.results[i][0].transcript;
      } else {
        interim += event.results[i][0].transcript;
      }
    }
    document.getElementById('voice-transcript').textContent = final || interim;
    if (final) {
      stopVoice();
      handleVoiceCommand(final.trim());
    }
  };

  recognition.onerror = (e) => {
    stopVoice();
    document.getElementById('voice-status').textContent = 'Error: ' + e.error;
  };

  recognition.onend = () => stopVoice();
  recognition.start();
}

function stopVoice() {
  voiceActive = false;
  if (recognition) { try { recognition.stop(); } catch {} }
  document.getElementById('voice-btn').textContent    = '🎤 Start Listening';
  document.getElementById('voice-btn').style.background = '#7c3aed';
  document.getElementById('voice-status').textContent = 'Click to activate browser voice';
}

async function handleVoiceCommand(command) {
  document.getElementById('voice-status').textContent = 'Processing: "' + command + '"';
  
  // Show response area
  const respEl = document.getElementById('voice-response');
  respEl.style.display = 'block';
  respEl.textContent   = 'Thinking...';

  // Run as Tejas task
  const res = await fetch('/api/run', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ task: command })
  });
  const data = await res.json();

  if (data.error) {
    respEl.textContent = 'Error: ' + data.error;
    speakText('I encountered an error. ' + data.error);
  } else {
    respEl.textContent = 'Task queued: ' + command + '. Watch the live feed for results.';
    speakText('Understood. Executing: ' + command);
  }
  
  document.getElementById('voice-status').textContent = 'Done — say another command?';
}

function speakText(text) {
  const t = text || document.getElementById('tts-input').value.trim();
  if (!t) return;
  
  if (!synth) { alert('Speech synthesis not supported in this browser.'); return; }
  
  synth.cancel();
  const utt      = new SpeechSynthesisUtterance(t);
  utt.rate        = 0.95;
  utt.pitch       = 0.85;
  utt.volume      = 1.0;

  // Try to find a good male English voice
  const voices = synth.getVoices();
  const preferred = voices.find(v =>
    v.lang.startsWith('en') && (v.name.includes('Male') || v.name.includes('David') || v.name.includes('Mark') || v.name.includes('Daniel'))
  ) || voices.find(v => v.lang.startsWith('en')) || voices[0];

  if (preferred) utt.voice = preferred;
  synth.speak(utt);
}

async function speakStatus() {
  const data = await api('/api/stats');
  if (data.error) return;
  const tasks = data.memory?.tasks_run || 0;
  const nodes = data.graph?.total_nodes || 0;
  speakText(\`Status report. \${tasks} tasks completed. \${nodes} knowledge nodes in memory. All systems operational.\`);
}

// Preload voices
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

// Redraw graph on resize
window.addEventListener('resize', renderGraph);
</script>
</body>
</html>`;
  }
}

module.exports = DashboardServer;
