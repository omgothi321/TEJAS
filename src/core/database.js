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
      CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(task, content='tasks', content_rowid='id')
    `).run();

    this.db.prepare(`
      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(label, content='graph_nodes', content_rowid='id')
    `).run();
  }

  // Helper to run cosine similarity if needed, though usually better in JS for small sets
  // or using a custom extension if we had one.
}

module.exports = TejasDatabase;
