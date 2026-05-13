'use strict';

const fs   = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { KnowledgeGraph } = require('./graph');
const TejasDatabase = require('./database');
const EmbeddingService = require('./embeddings');

// ─── PATHS ───────────────────────────────────────────────────────────────────
const TEJAS_DIR     = '.tejas';
const DB_FILE       = 'tejas.db';
const MEMORY_FILE   = 'memory.json';
const CONFIG_FILE   = 'config.json';
const LOGS_DIR      = 'logs';

// ─── DEFAULT MEMORY SCHEMA ───────────────────────────────────────────────────
const DEFAULT_MEMORY = {
  version: '0.1.0',
  created_at: null,
  updated_at: null,
  project: {
    name: null,
    type: null,
    description: null,
    root: null
  },
  user: {
    name: null,
    preferences: {},
    work_patterns: [],
    shortcuts: {}
  },
  knowledge: {
    workflows: [],
    patterns: [],
    commands: [],
    notes: []
  },
  agents: {
    last_active: null,
    history: []
  },
  world_model: {
    environment: 'development',
    os: null,
    tools: [],
    devices: [],
    integrations: []
  },
  stats: {
    tasks_run: 0,
    patterns_learned: 0,
    commands_saved: 0,
    total_interactions: 0,
    time_saved_minutes: 0
  }
};

// ─── DEFAULT CONFIG ───────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  model: 'groq',
  api_keys: {
    claude: null,
    deepseek: null,
    openai: null,
    gemini: null,
    ollama_url: 'http://localhost:11434'
  },
  preferences: {
    verbose: false,
    auto_learn: true,
    memory_enabled: true,
    banner: true,
    theme: 'dark'
  },
  agents: {
    auto_select: true,
    max_parallel: 3,
    timeout_ms: 30000
  }
};

// ─── MEMORY CLASS ─────────────────────────────────────────────────────────────
class MemoryManager {
  constructor(rootDir = process.cwd()) {
    this.rootDir   = rootDir;
    this.tejasDir  = path.join(rootDir, TEJAS_DIR);
    this.dbPath    = path.join(this.tejasDir, DB_FILE);
    this.memFile   = path.join(this.tejasDir, MEMORY_FILE);
    this.confFile  = path.join(this.tejasDir, CONFIG_FILE);
    this.logsDir   = path.join(this.tejasDir, LOGS_DIR);
    this._memory   = null;
    this._config   = null;

    this.db         = new TejasDatabase(this.tejasDir);
    this.embeddings = new EmbeddingService(this.tejasDir);
    // ── Knowledge Graph (v0.2) ──
    this.graph     = new KnowledgeGraph(this.tejasDir, this.db, this.embeddings);
  }

  // ── INIT ─────────────────────────────────────────────────────────────────
  async initialize(projectMeta = {}) {
    await fs.ensureDir(this.tejasDir);
    await fs.ensureDir(this.logsDir);

    // 1. Initialize DB & Embeddings
    await this.db.initialize();
    
    // ── Warmup semantic engine (Issue #7) ──
    console.log('[Tejas] Warming up semantic engine (first run only)...');
    try {
      await this.embeddings.initialize();
      console.log('[Tejas] Semantic engine ready.');
    } catch (e) {
      console.warn('[Tejas] Semantic engine unavailable — falling back to keyword search');
    }

    // 2. Migration or Initial Load
    const hasDb = await this._hasDataInDb();
    const hasJson = await fs.pathExists(this.memFile);

    if (!hasDb && hasJson) {
      console.log('Migrating Tejas memory to SQLite...');
      await this._migrateJsonToSqlite();
    } else if (!hasDb && !hasJson) {
      await this._initDefaultData(projectMeta);
    }

    // 3. Load active state
    this._memory = await this.read();
    this._config = await this.readConfig();

    return { memory: this._memory, config: this._config };
  }

  async _hasDataInDb() {
    if (!this.db || !this.db.db) return false;
    try {
      const row = this.db.db.prepare("SELECT count(*) as count FROM settings WHERE key = 'memory'").get();
      return row && row.count > 0;
    } catch (err) {
      return false;
    }
  }

  async _initDefaultData(projectMeta) {
    const mem = {
      ...DEFAULT_MEMORY,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      project: {
        ...DEFAULT_MEMORY.project,
        root: this.rootDir,
        ...projectMeta
      },
      world_model: {
        ...DEFAULT_MEMORY.world_model,
        os: process.platform
      }
    };
    await this.write(mem);
    await this.writeConfig(DEFAULT_CONFIG);
  }

  async _migrateJsonToSqlite() {
    const mem = await fs.readJson(this.memFile);
    const conf = await fs.pathExists(this.confFile) ? await fs.readJson(this.confFile) : DEFAULT_CONFIG;
    
    await this.write(mem);
    await this.writeConfig(conf);

    // Migrate graph if exists
    await this.graph.migrate();

    // Backup old files
    await fs.rename(this.memFile, this.memFile + '.bak');
    if (await fs.pathExists(this.confFile)) await fs.rename(this.confFile, this.confFile + '.bak');
    console.log('Migration complete. Old files backed up to .bak');
  }

  // ── CHECK EXISTS ──────────────────────────────────────────────────────────
  async exists() {
    if (!await fs.pathExists(this.dbPath)) return false;
    try {
      if (!this.db.db) await this.db.initialize();
      return await this._hasDataInDb();
    } catch (err) {
      return false;
    }
  }

  // ── READ MEMORY ───────────────────────────────────────────────────────────
  async read() {
    const row = this.db.db.prepare("SELECT value FROM settings WHERE key = 'memory'").get();
    if (!row) return DEFAULT_MEMORY;
    this._memory = JSON.parse(row.value);
    return this._memory;
  }

  // ── WRITE MEMORY ──────────────────────────────────────────────────────────
  async write(updates = {}) {
    const current = (await this.exists()) ? await this.read() : DEFAULT_MEMORY;
    // If updates is a full object (has version), use it directly
    const updated = updates.version ? updates : this._deepMerge(current, updates);
    updated.updated_at = new Date().toISOString();
    
    this.db.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('memory', ?)")
      .run(JSON.stringify(updated));
    
    this._memory = updated;
    return updated;
  }

  // ── READ CONFIG ───────────────────────────────────────────────────────────
  async readConfig() {
    const row = this.db.db.prepare("SELECT value FROM settings WHERE key = 'config'").get();
    if (!row) return DEFAULT_CONFIG;
    this._config = JSON.parse(row.value);
    return this._config;
  }

  // ── WRITE CONFIG ──────────────────────────────────────────────────────────
  async writeConfig(updates = {}) {
    let current;
    try {
      current = await this.readConfig();
    } catch (e) {
      current = DEFAULT_CONFIG;
    }
    
    const updated = updates.model ? updates : this._deepMerge(current, updates);
    
    this.db.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('config', ?)")
      .run(JSON.stringify(updated));
    
    this._config = updated;
    return updated;
  }

  // ── ADD WORKFLOW ──────────────────────────────────────────────────────────
  async addWorkflow(workflow) {
    const mem = await this.read();
    const entry = {
      id: uuidv4(),
      created_at: new Date().toISOString(),
      used_count: 0,
      last_used: null,
      ...workflow
    };
    mem.knowledge.workflows.push(entry);
    mem.stats.patterns_learned++;
    await this.write({ knowledge: { workflows: mem.knowledge.workflows }, stats: mem.stats });
    return entry;
  }

  // ── ADD PATTERN ───────────────────────────────────────────────────────────
  async addPattern(pattern) {
    const mem = await this.read();
    const entry = {
      id: uuidv4(),
      created_at: new Date().toISOString(),
      confidence: 1.0,
      ...pattern
    };
    mem.knowledge.patterns.push(entry);
    await this.write({ knowledge: { patterns: mem.knowledge.patterns } });
    return entry;
  }

  // ── LOG TASK ──────────────────────────────────────────────────────────────
  async logTask(task) {
    const mem = await this.read();
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    const entry = { id, timestamp, ...task };

    // 1. Semantic Embedding
    let embedding = null;
    try {
      embedding = await this.embeddings.embed(task.task);
    } catch (err) {
      if (this._config?.preferences?.verbose) console.warn('[Memory] Embedding failed:', err.message);
    }

    // 2. Persistent SQL Log
    try {
      this.db.db.prepare(`
        INSERT INTO tasks (id, task, embedding, agent, success, duration_ms, plan)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        task.task,
        embedding ? Buffer.from(embedding.buffer) : null,
        task.agent,
        task.success ? 1 : 0,
        task.duration_ms || 0,
        JSON.stringify(task.steps_detail || [])
      );
    } catch (err) {
      console.error('[Memory] SQL Log failed:', err.message);
    }

    // 3. Update legacy memory state (shrunk)
    mem.agents.history.unshift(entry);
    if (mem.agents.history.length > 50) mem.agents.history = mem.agents.history.slice(0, 50);
    mem.agents.last_active = timestamp;
    mem.stats.tasks_run++;
    mem.stats.total_interactions++;
    
    await this.write({ agents: mem.agents, stats: mem.stats });

    // 4. Knowledge Graph Ingestion
    await this.graph.ingestTask({
      task:        task.task,
      steps:       task.steps_detail || [],
      success:     task.success,
      agent:       task.agent,
      duration_ms: task.duration_ms,
      error:       task.error_message || null,
      embedding:   embedding
    });

    return entry;
  }

  // ── SEARCH MEMORY ─────────────────────────────────────────────────────────
  async search(query) {
    if (!query) return [];
    const results = [];

    // 1. FTS5 search on tasks
    try {
      const ftsTasks = this.db.db.prepare(`
        SELECT t.id, t.task, t.agent, t.success 
        FROM tasks t
        JOIN tasks_fts f ON t.rowid = f.rowid
        WHERE f.task MATCH ? LIMIT 10
      `).all(query);
      ftsTasks.forEach(r => results.push({ type: 'task', ...r }));
    } catch (err) {}

    // 2. FTS5 search on graph nodes
    try {
      const ftsNodes = this.db.db.prepare(`
        SELECT n.id, n.type, n.label 
        FROM graph_nodes n
        JOIN nodes_fts f ON n.rowid = f.rowid
        WHERE f.label MATCH ? LIMIT 10
      `).all(query);
      ftsNodes.forEach(r => results.push({ type: r.type, ...r }));
    } catch (err) {}

    // 3. Semantic search via graph.recall
    const semantic = await this.graph.recall(query, 5);
    semantic.forEach(r => {
      if (r.relevance > 0.6) {
        results.push({ type: 'semantic', label: r.node.label, relevance: r.relevance });
      }
    });

    return results;
  }

  // ── CLEAR MEMORY ──────────────────────────────────────────────────────────
  async clear() {
    const config = await this.readConfig();
    
    // Clear SQLite tables
    this.db.db.prepare('DELETE FROM tasks').run();
    this.db.db.prepare('DELETE FROM graph_nodes').run();
    this.db.db.prepare('DELETE FROM graph_edges').run();
    this.db.db.prepare('DELETE FROM cache').run();
    this.db.db.prepare("DELETE FROM settings WHERE key = 'memory'").run();
    
    await fs.remove(this.logsDir);
    this._memory = null;
    await this.initialize({ name: this._memory?.project?.name });
    await this.writeConfig(config);
  }

  // ── EXPORT MEMORY ─────────────────────────────────────────────────────────
  async export(destPath) {
    const mem = await this.read();
    await fs.writeJson(destPath, mem, { spaces: 2 });
    return destPath;
  }

  // ── IMPORT MEMORY ─────────────────────────────────────────────────────────
  async import(filePath) {
    const imported = await fs.readJson(filePath);
    await this.write(imported);
    return imported;
  }

  // ── DEEP MERGE ────────────────────────────────────────────────────────────
  _deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      // 🛡️ Prototype pollution guard
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;

      if (
        source[key] !== null &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key])
      ) {
        result[key] = this._deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  // ── GET CONTEXT SUMMARY ───────────────────────────────────────────────────
  // Now uses graph recall for smart, relevant context instead of flat list
  async getContextSummary(currentTask = null) {
    const mem = await this.read();

    // Base context (always included)
    const base = {
      project:         mem.project,
      user:            mem.user,
      patterns_count:  mem.knowledge.patterns.length,
      workflows_count: mem.knowledge.workflows.length,
      recent_tasks:    mem.agents.history.slice(0, 5),
      stats:           mem.stats,
      tools:           mem.world_model.tools,
      integrations:    mem.world_model.integrations
    };

    // Smart graph context (if task provided)
    if (currentTask) {
      try {
        const recalled   = await this.graph.recall(currentTask, 5);
        const patterns   = await this.graph.findPatterns();
        base.graph_context = {
          relevant_nodes: recalled.map(r => ({
            type:        r.node.type,
            label:       r.node.label,
            relevance:   Math.round(r.relevance * 100) / 100,
            connections: r.neighbours.length,
            used:        r.node.use_count
          })),
          patterns: patterns.slice(0, 3),
          graph_size: await this.graph.getStats()
        };
      } catch {
        // Graph not initialized yet — no problem, fall back to base
      }
    }

    return base;
  }

  // ── GRAPH STATS ───────────────────────────────────────────────────────────
  async getGraphStats() {
    return this.graph.getStats();
  }

  // ── GRAPH SEARCH ──────────────────────────────────────────────────────────
  async graphSearch(query) {
    return this.graph.search(query);
  }

  // ── GRAPH VISUALIZE ───────────────────────────────────────────────────────
  async graphVisualize(nodeId = null) {
    return this.graph.visualize(nodeId);
  }

  // ── FIND PATTERNS ─────────────────────────────────────────────────────────
  async findPatterns() {
    return this.graph.findPatterns();
  }

  // ── MEMGPT: MEMORY COMPRESSION ────────────────────────────────────────────
  async compress() {
    try {
      const mem = await this.read();
      if (!mem || !mem.agents || !mem.agents.history) return null;

      const history   = mem.agents.history;
      const thirtyDays = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const recent    = history.filter(function(t) {
        return t && t.timestamp && new Date(t.timestamp).getTime() > thirtyDays;
      });
      const old       = history.filter(function(t) {
        return t && t.timestamp && new Date(t.timestamp).getTime() <= thirtyDays;
      });

      if (old.length < 10) return null;

      const summary = {
        period:       new Date().toISOString(),
        task_count:   old.length,
        agents_used:  [...new Set(old.map(function(t) { return t.agent || 'unknown'; }))],
        compressed_at: new Date().toISOString()
      };

      mem.agents.history = recent;
      if (!mem.archive) mem.archive = [];
      mem.archive.push(summary);

      await this.write({ agents: mem.agents, archive: mem.archive });
      return summary;
    } catch {
      return null;
    }
  }
}

module.exports = MemoryManager;
