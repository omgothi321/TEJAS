'use strict';

const fs   = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { KnowledgeGraph } = require('./graph');

// ─── PATHS ───────────────────────────────────────────────────────────────────
const TEJAS_DIR     = '.tejas';
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
    this.memFile   = path.join(this.tejasDir, MEMORY_FILE);
    this.confFile  = path.join(this.tejasDir, CONFIG_FILE);
    this.logsDir   = path.join(this.tejasDir, LOGS_DIR);
    this._memory   = null;
    this._config   = null;
    // ── Knowledge Graph (v0.2) ──
    this.graph     = new KnowledgeGraph(path.join(rootDir, TEJAS_DIR));
  }

  // ── INIT ─────────────────────────────────────────────────────────────────
  async initialize(projectMeta = {}) {
    await fs.ensureDir(this.tejasDir);
    await fs.ensureDir(this.logsDir);

    // Memory
    if (!await fs.pathExists(this.memFile)) {
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
      await fs.writeJson(this.memFile, mem, { spaces: 2 });
      this._memory = mem;
    } else {
      this._memory = await fs.readJson(this.memFile);
    }

    // Config
    if (!await fs.pathExists(this.confFile)) {
      await fs.writeJson(this.confFile, DEFAULT_CONFIG, { spaces: 2 });
      this._config = DEFAULT_CONFIG;
    } else {
      this._config = await fs.readJson(this.confFile);
    }

    return { memory: this._memory, config: this._config };
  }

  // ── CHECK EXISTS ──────────────────────────────────────────────────────────
  async exists() {
    return fs.pathExists(this.memFile);
  }

  // ── READ MEMORY ───────────────────────────────────────────────────────────
  async read() {
    if (!await this.exists()) {
      throw new Error('Tejas not initialized. Run: tejas init');
    }
    this._memory = await fs.readJson(this.memFile);
    return this._memory;
  }

  // ── WRITE MEMORY ──────────────────────────────────────────────────────────
  async write(updates = {}) {
    const current = await this.read();
    const updated = this._deepMerge(current, updates);
    updated.updated_at = new Date().toISOString();
    await fs.writeJson(this.memFile, updated, { spaces: 2 });
    this._memory = updated;
    return updated;
  }

  // ── READ CONFIG ───────────────────────────────────────────────────────────
  async readConfig() {
    if (!await fs.pathExists(this.confFile)) {
      throw new Error('Tejas not initialized. Run: tejas init');
    }
    this._config = await fs.readJson(this.confFile);
    return this._config;
  }

  // ── WRITE CONFIG ──────────────────────────────────────────────────────────
  async writeConfig(updates = {}) {
    const current = await this.readConfig();
    const updated = this._deepMerge(current, updates);
    await fs.writeJson(this.confFile, updated, { spaces: 2 });
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
    const entry = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      ...task
    };
    mem.agents.history.unshift(entry);
    // Keep only last 100
    if (mem.agents.history.length > 100) {
      mem.agents.history = mem.agents.history.slice(0, 100);
    }
    mem.agents.last_active = entry.timestamp;
    mem.stats.tasks_run++;
    mem.stats.total_interactions++;
    await this.write({
      agents: mem.agents,
      stats: mem.stats
    });

    // Also write to log file
    const logFile = path.join(this.logsDir, `${new Date().toISOString().split('T')[0]}.log`);
    await fs.appendFile(logFile, JSON.stringify(entry) + '\n');

    // ── Feed Knowledge Graph (v0.2) ──
    await this.graph.ingestTask({
      task:        task.task,
      steps:       task.steps_detail || [],
      success:     task.success,
      agent:       task.agent,
      duration_ms: task.duration_ms,
      error:       task.error_message || null
    });

    return entry;
  }

  // ── SEARCH MEMORY ─────────────────────────────────────────────────────────
  async search(query) {
    const mem = await this.read();
    const q = query.toLowerCase();
    const results = [];

    // Search workflows
    mem.knowledge.workflows.forEach(w => {
      if (
        (w.name && w.name.toLowerCase().includes(q)) ||
        (w.description && w.description.toLowerCase().includes(q)) ||
        (w.trigger && w.trigger.toLowerCase().includes(q))
      ) {
        results.push({ type: 'workflow', ...w });
      }
    });

    // Search patterns
    mem.knowledge.patterns.forEach(p => {
      if (
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.value && p.value.toLowerCase().includes(q))
      ) {
        results.push({ type: 'pattern', ...p });
      }
    });

    // Search history
    mem.agents.history.forEach(h => {
      if (h.task && h.task.toLowerCase().includes(q)) {
        results.push({ type: 'history', ...h });
      }
    });

    return results;
  }

  // ── CLEAR ─────────────────────────────────────────────────────────────────
  async clear() {
    const config = await this.readConfig();
    await fs.remove(this.memFile);
    await fs.remove(this.logsDir);
    await this.initialize({ name: this._memory?.project?.name });
    await this.writeConfig(config);
  }

  // ── EXPORT ────────────────────────────────────────────────────────────────
  async export(filePath) {
    const mem = await this.read();
    await fs.writeJson(filePath, mem, { spaces: 2 });
    return filePath;
  }

  // ── IMPORT ────────────────────────────────────────────────────────────────
  async import(filePath) {
    const imported = await fs.readJson(filePath);
    await fs.writeJson(this.memFile, imported, { spaces: 2 });
    this._memory = imported;
    return imported;
  }

  // ── DEEP MERGE ────────────────────────────────────────────────────────────
  _deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
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
