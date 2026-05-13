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
    await this.memory.initialize();

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
    return '<html><body><h1>Tejas Dashboard</h1><p>UI content moved to separate file for stability.</p></body></html>';
  }
}

module.exports = DashboardServer;
