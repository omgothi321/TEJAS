'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs-extra');

class TejasDatabase {
  constructor(tejasDir) {
    this.dbPath = path.join(tejasDir, 'tejas.db');
    this.db = null;
  }

  async initialize() {
    await fs.ensureDir(path.dirname(this.dbPath));
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');

    this._createTables();
    return this;
  }

  _createTables() {
    // Tasks history
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        task TEXT NOT NULL,
        embedding BLOB,
        agent TEXT,
        success INTEGER DEFAULT 0,
        duration_ms INTEGER,
        plan TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `).run();

    // Knowledge Graph Nodes
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS graph_nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        tags TEXT, -- JSON array
        properties TEXT, -- JSON object
        embedding BLOB,
        use_count INTEGER DEFAULT 0,
        last_seen INTEGER DEFAULT (unixepoch()),
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      )
    `).run();

    // Knowledge Graph Edges
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS graph_edges (
        src TEXT REFERENCES graph_nodes(id),
        dst TEXT REFERENCES graph_nodes(id),
        type TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        created_at INTEGER DEFAULT (unixepoch()),
        PRIMARY KEY (src, dst, type)
      )
    `).run();

    // Semantic Cache
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS cache (
        id TEXT PRIMARY KEY,
        task TEXT NOT NULL,
        embedding BLOB,
        plan TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `).run();

    // Settings / Config
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `).run();

    // Full-Text Search for tasks and nodes
    this.db.prepare(`
      CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(task, content='tasks')
    `).run();

    this.db.prepare(`
      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(label, content='graph_nodes')
    `).run();

    // ── FTS5 TRIGGERS ───────────────────────────────────────────────────────
    this.db.prepare(`
      CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
        INSERT INTO tasks_fts(rowid, task) VALUES (new.rowid, new.task);
      END
    `).run();

    this.db.prepare(`
      CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
        INSERT INTO tasks_fts(tasks_fts, rowid, task) VALUES ('delete', old.rowid, old.task);
      END
    `).run();

    this.db.prepare(`
      CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON graph_nodes BEGIN
        INSERT INTO nodes_fts(rowid, label) VALUES (new.rowid, new.label);
      END
    `).run();

    this.db.prepare(`
      CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON graph_nodes BEGIN
        INSERT INTO nodes_fts(nodes_fts, rowid, label) VALUES ('delete', old.rowid, old.label);
      END
    `).run();

    // ── INDEXES ─────────────────────────────────────────────────────────────
    this.db.prepare('CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent)').run();
    this.db.prepare('CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC)').run();
    this.db.prepare('CREATE INDEX IF NOT EXISTS idx_nodes_type ON graph_nodes(type)').run();
    this.db.prepare('CREATE INDEX IF NOT EXISTS idx_nodes_use_count ON graph_nodes(use_count DESC)').run();
  }

  // Helper to run cosine similarity if needed, though usually better in JS for small sets
  // or using a custom extension if we had one.
}

module.exports = TejasDatabase;
