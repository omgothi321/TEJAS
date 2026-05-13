'use strict';

const fs   = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const EmbeddingService = require('./embeddings');

// ─── NODE TYPES ──────────────────────────────────────────────────────────────
const NODE_TYPES = {
  TASK:       'task',
  WORKFLOW:   'workflow',
  ENTITY:     'entity',
  FACT:       'fact',
  PREFERENCE: 'preference',
  ERROR:      'error',
  COMMAND:    'command',
  NOTE:       'note'
};

// ─── EDGE TYPES ──────────────────────────────────────────────────────────────
const EDGE_TYPES = {
  USED_WORKFLOW:       'used_workflow',
  CONTAINS_COMMAND:    'contains_command',
  RELATED_TO:          'related_to',
  CAUSED_ERROR:        'caused_error',
  FIXED_BY:            'fixed_by',
  FOLLOWS:             'follows',
  CONTRADICTS:         'contradicts',
  ASSOCIATED_WITH:     'associated_with',
  TRIGGERED_BY:        'triggered_by',
  LEARNED_FROM:        'learned_from'
};

// ─── GRAPH CLASS ─────────────────────────────────────────────────────────────
class KnowledgeGraph {
  constructor(tejasDir, db, embeddings) {
    this.tejasDir   = tejasDir;
    this.graphFile  = path.join(tejasDir, 'graph.json');
    this.db         = db;
    this.embeddings = embeddings;
  }

  // ── MIGRATE ───────────────────────────────────────────────────────────────
  async migrate() {
    if (!await fs.pathExists(this.graphFile)) return;
    
    console.log('[Graph] Migrating JSON graph to SQLite...');
    const oldGraph = await fs.readJson(this.graphFile);
    
    for (const [id, node] of Object.entries(oldGraph.nodes || {})) {
      let embedding = null;
      try { embedding = await this.embeddings.embed(node.label); } catch (err) {}

      this.db.db.prepare(`
        INSERT OR REPLACE INTO graph_nodes (id, type, label, tags, properties, embedding, use_count, last_seen, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, node.type, node.label, JSON.stringify(node.tags || []), JSON.stringify(node.data || {}),
        embedding ? Buffer.from(embedding.buffer) : null,
        node.use_count || 1,
        node.last_seen ? Math.floor(new Date(node.last_seen).getTime() / 1000) : Math.floor(Date.now() / 1000),
        node.created_at ? Math.floor(new Date(node.created_at).getTime() / 1000) : Math.floor(Date.now() / 1000),
        node.updated_at ? Math.floor(new Date(node.updated_at).getTime() / 1000) : Math.floor(Date.now() / 1000)
      );
    }

    for (const edge of (oldGraph.edges || [])) {
      try {
        this.db.db.prepare(`
          INSERT OR IGNORE INTO graph_edges (src, dst, type, weight, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          edge.from, edge.to, edge.type, edge.weight || 1.0,
          edge.created_at ? Math.floor(new Date(edge.created_at).getTime() / 1000) : Math.floor(Date.now() / 1000)
        );
      } catch (err) {}
    }

    await fs.rename(this.graphFile, this.graphFile + '.bak');
    console.log('[Graph] Migration complete.');
  }

  // ── ADD NODE ──────────────────────────────────────────────────────────────
  async addNode({ type, label, data = {}, tags = [], embedding = null }) {
    const existing = this.db.db.prepare("SELECT * FROM graph_nodes WHERE label = ? AND type = ?").get(label, type);
    if (existing) {
      this.db.db.prepare("UPDATE graph_nodes SET use_count = use_count + 1, last_seen = (unixepoch()), updated_at = (unixepoch()) WHERE id = ?").run(existing.id);
      return { 
        id: existing.id, 
        type: existing.type, 
        label: existing.label, 
        tags: JSON.parse(existing.tags || '[]'), 
        data: JSON.parse(existing.properties || '{}') 
      };
    }

    if (!embedding) {
      try { embedding = await this.embeddings.embed(label); } catch (err) {}
    }

    const id = uuidv4();
    this.db.db.prepare(`
      INSERT INTO graph_nodes (id, type, label, tags, properties, embedding, use_count)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(
      id, type, label, JSON.stringify(tags), JSON.stringify(data),
      embedding ? Buffer.from(embedding.buffer) : null
    );

    return { id, type, label, tags, data };
  }

  // ── ADD EDGE ──────────────────────────────────────────────────────────────
  async addEdge({ from, to, type, weight = 1.0 }) {
    try {
      this.db.db.prepare(`
        INSERT INTO graph_edges (src, dst, type, weight)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(src, dst, type) DO UPDATE SET weight = min(weight + 0.1, 5.0)
      `).run(from, to, type, weight);
    } catch (err) {}
  }

  // ── LOG TASK INTO GRAPH ───────────────────────────────────────────────────
  async ingestTask({ task, steps = [], success, agent, duration_ms, error = null, embedding = null }) {
    const taskNode = await this.addNode({
      type:  NODE_TYPES.TASK,
      label: task,
      data:  { agent, success, duration_ms },
      embedding: embedding,
      tags:  this._extractTags(task)
    });

    const entities = this._extractEntities(task);
    for (const entity of entities) {
      const entityNode = await this.addNode({
        type:  NODE_TYPES.ENTITY,
        label: entity,
        tags:  ['auto-extracted']
      });
      await this.addEdge({ from: taskNode.id, to: entityNode.id, type: EDGE_TYPES.ASSOCIATED_WITH });
    }

    for (const step of steps) {
      if (step.command) {
        const cmdNode = await this.addNode({
          type:  NODE_TYPES.COMMAND,
          label: step.command,
          data:  { description: step.description },
          tags:  ['shell']
        });
        await this.addEdge({ from: taskNode.id, to: cmdNode.id, type: EDGE_TYPES.CONTAINS_COMMAND });
      }
    }

    if (!success && error) {
      const errNode = await this.addNode({ type:  NODE_TYPES.ERROR, label: error, data:  { task, agent }, tags:  ['error'] });
      await this.addEdge({ from: taskNode.id, to: errNode.id, type: EDGE_TYPES.CAUSED_ERROR });
    }

    const prevTask = this._getLastTaskNode();
    if (prevTask && prevTask.id !== taskNode.id) {
      await this.addEdge({ from: taskNode.id, to: prevTask.id, type: EDGE_TYPES.FOLLOWS, weight: 0.5 });
    }

    return taskNode;
  }

  // ── SMART RECALL ─────────────────────────────────────────────────────────
  async recall(query, limit = 5) {
    let queryVec = null;
    try { queryVec = await this.embeddings.embed(query); } catch (err) {}

    // Pre-filter: only nodes with embeddings, ordered by use_count descending
    // Limit cosine scan to top 200 candidates
    const nodes = this.db.db.prepare(`
      SELECT * FROM graph_nodes 
      WHERE embedding IS NOT NULL 
      ORDER BY use_count DESC LIMIT 200
    `).all();

    const scored = nodes.map(node => {
      let score = 0;
      if (queryVec && node.embedding) {
        const nodeVec = new Float32Array(node.embedding.buffer, node.embedding.byteOffset, node.embedding.byteLength / 4);
        score = EmbeddingService.cosineSimilarity(queryVec, nodeVec);
      }
      if (node.label.toLowerCase().includes(query.toLowerCase())) score += 0.2;
      return { node, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const topNodes = scored.slice(0, limit);

    const context = [];
    for (const { node, score } of topNodes) {
      const neighbors = this.db.db.prepare(`
        SELECT n.*, e.type as edge_type, e.weight as edge_weight FROM graph_nodes n
        JOIN graph_edges e ON (e.dst = n.id AND e.src = ?) OR (e.src = n.id AND e.dst = ?)
      `).all(node.id, node.id);

      context.push({
        node: { ...node, tags: JSON.parse(node.tags || '[]'), properties: JSON.parse(node.properties || '{}') },
        relevance: score,
        neighbours: neighbors.map(n => ({
          node: { ...n, tags: JSON.parse(n.tags || '[]'), properties: JSON.parse(n.properties || '{}') },
          edge_type: n.edge_type,
          edge_weight: n.edge_weight
        }))
      });
    }
    return context;
  }

  async findPatterns() {
    const rows = this.db.db.prepare(`
      SELECT agent, count(*) as count, avg(duration_ms) as avg_ms,
             sum(success) as successes
      FROM tasks GROUP BY agent ORDER BY count DESC LIMIT 10
    `).all();
    return rows.map(r => ({
      type:       'agent_usage',
      label:      r.agent || 'unknown',
      count:      r.count,
      suggestion: `Agent '${r.agent}' used ${r.count} times, ${Math.round((r.successes/r.count)*100)}% success rate`
    }));
  }

  async getStats() {
    const nodes = this.db.db.prepare('SELECT count(*) as count FROM graph_nodes').get();
    const edges = this.db.db.prepare('SELECT count(*) as count FROM graph_edges').get();
    const tasks = this.db.db.prepare('SELECT count(*) as count FROM tasks').get();
    const lastRecall = this.db.db.prepare("SELECT value FROM settings WHERE key = 'last_recall'").get();
    const lastUpdate = this.db.db.prepare("SELECT updated_at FROM graph_nodes ORDER BY updated_at DESC LIMIT 1").get();
    
    return { 
      nodes: nodes.count, 
      edges: edges.count, 
      tasks: tasks.count,
      total_nodes: nodes.count,
      total_edges: edges.count,
      last_recall: lastRecall ? lastRecall.value : null,
      last_updated: lastUpdate ? new Date(lastUpdate.updated_at * 1000).toISOString() : null
    };
  }

  async search(query) {
    if (!query) return [];
    const q = query.toLowerCase();
    const rows = this.db.db.prepare(`
      SELECT * FROM graph_nodes
      WHERE lower(label) LIKE ? LIMIT 20
    `).all(`%${q}%`);
    return rows.map(r => ({
      type:            r.type,
      label:           r.label,
      relevance_score: r.use_count / 10,
      id:              r.id,
      use_count:       r.use_count
    }));
  }

  async visualize(nodeId = null) {
    const nodes = this.db.db.prepare('SELECT id, type, label, use_count FROM graph_nodes LIMIT 100').all();
    const edges = this.db.db.prepare('SELECT src, dst, type, weight FROM graph_edges LIMIT 200').all();
    
    // Return a simple tree-like string for the CLI visualize command
    let output = 'Knowledge Graph Structure:\n\n';
    nodes.slice(0, 20).forEach(n => {
      output += `[${n.type}] ${n.label} (used: ${n.use_count})\n`;
      const connections = edges.filter(e => e.src === n.id || e.dst === n.id);
      connections.slice(0, 3).forEach(e => {
        const otherId = e.src === n.id ? e.dst : e.src;
        const otherNode = nodes.find(nn => nn.id === otherId);
        if (otherNode) {
          output += `  └─ ${e.type} ─> [${otherNode.type}] ${otherNode.label}\n`;
        }
      });
      output += '\n';
    });
    
    return output;
  }

  _getLastTaskNode() {
    const row = this.db.db.prepare("SELECT * FROM graph_nodes WHERE type = 'task' ORDER BY created_at DESC LIMIT 1 OFFSET 1").get();
    return row || null;
  }

  _extractTags(text) {
    const tags = [];
    const lower = text.toLowerCase();
    const tagMap = { 'git': 'git', 'npm': 'npm', 'node': 'node', 'python': 'python', 'docker': 'docker', 'api': 'api' };
    for (const [kw, tag] of Object.entries(tagMap)) if (lower.includes(kw)) tags.push(tag);
    return [...new Set(tags)];
  }

  _extractEntities(text) {
    const entities = [];
    const quoted = text.match(/"([^"]+)"|'([^']+)'/g) || [];
    entities.push(...quoted.map(q => q.replace(/["']/g, '')));
    const paths = text.match(/[\w.-]+\/[\w.-]+/g) || [];
    entities.push(...paths);
    return [...new Set(entities)].filter(e => e.length > 1);
  }
}

module.exports = { KnowledgeGraph, NODE_TYPES, EDGE_TYPES };
