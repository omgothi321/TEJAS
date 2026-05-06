'use strict';

/**
 * TEJAS KNOWLEDGE GRAPH
 * ─────────────────────────────────────────────────────────────────
 * This is the brain upgrade from v0.1 flat memory → v0.2 graph memory.
 *
 * Old memory:  flat lists of workflows, patterns, history
 * New memory:  nodes + edges + tags + relevance scoring
 *
 * A node can be:  task | workflow | entity | fact | preference | error
 * An edge links:  node → node with a relationship type
 *
 * Example graph:
 *   [task: "setup git"]
 *       ↓ used_workflow
 *   [workflow: "git init flow"]
 *       ↓ contains_command
 *   [entity: "git init"]
 *       ↓ related_to
 *   [entity: "github"]
 *       ↓ associated_with
 *   [preference: "always use main branch"]
 */

const fs   = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ─── NODE TYPES ──────────────────────────────────────────────────────────────
const NODE_TYPES = {
  TASK:       'task',        // A task that was run
  WORKFLOW:   'workflow',    // A saved multi-step workflow
  ENTITY:     'entity',      // A named thing (tool, file, person, project)
  FACT:       'fact',        // A learned piece of information
  PREFERENCE: 'preference',  // A user preference
  ERROR:      'error',       // A failed task / error pattern
  COMMAND:    'command',     // A shell command
  NOTE:       'note'         // A freeform note
};

// ─── EDGE TYPES ──────────────────────────────────────────────────────────────
const EDGE_TYPES = {
  USED_WORKFLOW:       'used_workflow',
  CONTAINS_COMMAND:    'contains_command',
  RELATED_TO:          'related_to',
  CAUSED_ERROR:        'caused_error',
  FIXED_BY:            'fixed_by',
  FOLLOWS:             'follows',        // task A → follows → task B (sequence)
  CONTRADICTS:         'contradicts',    // preference A contradicts preference B
  ASSOCIATED_WITH:     'associated_with',
  TRIGGERED_BY:        'triggered_by',
  LEARNED_FROM:        'learned_from'
};

// ─── GRAPH CLASS ─────────────────────────────────────────────────────────────
class KnowledgeGraph {
  constructor(tejasDir) {
    this.tejasDir   = tejasDir;
    this.graphFile  = path.join(tejasDir, 'graph.json');
    this._graph     = null;
  }

  // ── DEFAULT GRAPH STRUCTURE ───────────────────────────────────────────────
  _defaultGraph() {
    return {
      version:    '0.2.0',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      nodes:      {},   // id → node object
      edges:      [],   // array of edge objects
      index: {
        by_type:  {},   // type → [ids]
        by_tag:   {},   // tag  → [ids]
        by_text:  {}    // keyword → [ids]  (inverted index for fast search)
      },
      stats: {
        total_nodes:    0,
        total_edges:    0,
        most_used_node: null,
        last_recall:    null
      }
    };
  }

  // ── LOAD ──────────────────────────────────────────────────────────────────
  async load() {
    await fs.ensureDir(this.tejasDir);
    if (await fs.pathExists(this.graphFile)) {
      this._graph = await fs.readJson(this.graphFile);
    } else {
      this._graph = this._defaultGraph();
      await this._save();
    }
    return this._graph;
  }

  // ── SAVE ──────────────────────────────────────────────────────────────────
  async _save() {
    this._graph.updated_at = new Date().toISOString();
    await fs.writeJson(this.graphFile, this._graph, { spaces: 2 });
  }

  // ── ADD NODE ──────────────────────────────────────────────────────────────
  async addNode({ type, label, data = {}, tags = [] }) {
    if (!this._graph) await this.load();

    // Check for duplicate by label + type
    const existing = this._findByLabelAndType(label, type);
    if (existing) {
      // Update use count and return existing
      existing.use_count = (existing.use_count || 0) + 1;
      existing.last_seen = new Date().toISOString();
      await this._save();
      return existing;
    }

    const id   = uuidv4();
    const node = {
      id,
      type,
      label,
      data,
      tags,
      use_count:  1,
      created_at: new Date().toISOString(),
      last_seen:  new Date().toISOString(),
      relevance:  1.0    // starts at 1, grows with use
    };

    this._graph.nodes[id] = node;
    this._graph.stats.total_nodes++;

    // Update indexes
    this._indexNode(node);

    await this._save();
    return node;
  }

  // ── ADD EDGE ──────────────────────────────────────────────────────────────
  async addEdge({ from, to, type, weight = 1.0, data = {} }) {
    if (!this._graph) await this.load();

    // Prevent duplicate edges
    const exists = this._graph.edges.find(
      e => e.from === from && e.to === to && e.type === type
    );
    if (exists) {
      exists.weight = Math.min(exists.weight + 0.1, 5.0); // strengthen with reuse
      await this._save();
      return exists;
    }

    const edge = {
      id:         uuidv4(),
      from,
      to,
      type,
      weight,
      data,
      created_at: new Date().toISOString()
    };

    this._graph.edges.push(edge);
    this._graph.stats.total_edges++;
    await this._save();
    return edge;
  }

  // ── LOG TASK INTO GRAPH ───────────────────────────────────────────────────
  // This is the main method called after every tejas run
  async ingestTask({ task, steps = [], success, agent, duration_ms, error = null }) {
    if (!this._graph) await this.load();

    // 1. Create task node
    const taskNode = await this.addNode({
      type:  NODE_TYPES.TASK,
      label: task,
      data:  { agent, success, duration_ms },
      tags:  this._extractTags(task)
    });

    // 2. Extract entities from the task text
    const entities = this._extractEntities(task);
    for (const entity of entities) {
      const entityNode = await this.addNode({
        type:  NODE_TYPES.ENTITY,
        label: entity,
        tags:  ['auto-extracted']
      });
      await this.addEdge({
        from: taskNode.id,
        to:   entityNode.id,
        type: EDGE_TYPES.ASSOCIATED_WITH
      });
    }

    // 3. Add command nodes from steps
    for (const step of steps) {
      if (step.command) {
        const cmdNode = await this.addNode({
          type:  NODE_TYPES.COMMAND,
          label: step.command,
          data:  { description: step.description },
          tags:  ['shell']
        });
        await this.addEdge({
          from: taskNode.id,
          to:   cmdNode.id,
          type: EDGE_TYPES.CONTAINS_COMMAND
        });
      }
    }

    // 4. If failed, log error node
    if (!success && error) {
      const errNode = await this.addNode({
        type:  NODE_TYPES.ERROR,
        label: error,
        data:  { task, agent },
        tags:  ['error']
      });
      await this.addEdge({
        from: taskNode.id,
        to:   errNode.id,
        type: EDGE_TYPES.CAUSED_ERROR
      });
    }

    // 5. Link to previous task (sequence awareness)
    const prevTask = this._getLastTaskNode();
    if (prevTask && prevTask.id !== taskNode.id) {
      await this.addEdge({
        from:   taskNode.id,
        to:     prevTask.id,
        type:   EDGE_TYPES.FOLLOWS,
        weight: 0.5
      });
    }

    return taskNode;
  }

  // ── SMART RECALL ─────────────────────────────────────────────────────────
  // Given a new task, find the most relevant past context from the graph
  async recall(query, limit = 5) {
    if (!this._graph) await this.load();

    this._graph.stats.last_recall = new Date().toISOString();
    const q      = query.toLowerCase();
    const scored = [];
    const tags   = this._extractTags(query);
    const entities = this._extractEntities(query);

    for (const node of Object.values(this._graph.nodes)) {
      let score = 0;

      // Label match (highest weight)
      if (node.label.toLowerCase().includes(q)) score += 3.0;

      // Partial word match
      const qWords = q.split(/\s+/).filter(w => w.length > 3);
      for (const word of qWords) {
        if (node.label.toLowerCase().includes(word)) score += 1.0;
      }

      // Tag match
      for (const tag of tags) {
        if ((node.tags || []).includes(tag)) score += 0.5;
      }

      // Entity match
      for (const entity of entities) {
        if (node.label.toLowerCase().includes(entity.toLowerCase())) score += 1.5;
      }

      // Recency boost (nodes used recently are more relevant)
      const ageMs  = Date.now() - new Date(node.last_seen).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays < 1)  score += 1.0;
      if (ageDays < 7)  score += 0.5;
      if (ageDays < 30) score += 0.2;

      // Use count boost
      score += Math.min((node.use_count || 1) * 0.1, 1.0);

      // Relevance multiplier
      score *= (node.relevance || 1.0);

      if (score > 0) scored.push({ node, score });
    }

    // Sort by score, return top N
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit).map(s => s.node);

    // For each top node, also return its connected neighbours
    const context = [];
    for (const node of top) {
      const neighbours = this._getNeighbours(node.id, 2);
      context.push({ node, neighbours, relevance: scored.find(s => s.node.id === node.id)?.score });
    }

    await this._save(); // persist updated last_recall
    return context;
  }

  // ── GET NEIGHBOURS ───────────────────────────────────────────────────────
  _getNeighbours(nodeId, maxDepth = 1) {
    const visited  = new Set([nodeId]);
    const result   = [];
    let   frontier = [nodeId];

    for (let depth = 0; depth < maxDepth; depth++) {
      const next = [];
      for (const id of frontier) {
        const edges = this._graph.edges.filter(e => e.from === id || e.to === id);
        for (const edge of edges) {
          const otherId = edge.from === id ? edge.to : edge.from;
          if (!visited.has(otherId) && this._graph.nodes[otherId]) {
            visited.add(otherId);
            next.push(otherId);
            result.push({
              node:         this._graph.nodes[otherId],
              edge_type:    edge.type,
              edge_weight:  edge.weight
            });
          }
        }
      }
      frontier = next;
    }

    return result;
  }

  // ── FIND PATTERNS ─────────────────────────────────────────────────────────
  // Detect recurring task sequences and suggest workflows
  async findPatterns() {
    if (!this._graph) await this.load();

    const taskNodes = Object.values(this._graph.nodes)
      .filter(n => n.type === NODE_TYPES.TASK)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const patterns = [];

    // Find tasks run 3+ times
    const labelCounts = {};
    for (const n of taskNodes) {
      const key = this._normalizeLabel(n.label);
      labelCounts[key] = (labelCounts[key] || 0) + 1;
    }

    for (const [label, count] of Object.entries(labelCounts)) {
      if (count >= 3) {
        patterns.push({
          type:        'recurring_task',
          label,
          count,
          suggestion:  `Save "${label}" as a named workflow — you've done it ${count} times`
        });
      }
    }

    // Find error patterns (same error 2+ times)
    const errorNodes = Object.values(this._graph.nodes)
      .filter(n => n.type === NODE_TYPES.ERROR);
    const errorCounts = {};
    for (const n of errorNodes) {
      const key = this._normalizeLabel(n.label);
      errorCounts[key] = (errorCounts[key] || 0) + 1;
    }
    for (const [label, count] of Object.entries(errorCounts)) {
      if (count >= 2) {
        patterns.push({
          type:        'recurring_error',
          label,
          count,
          suggestion:  `You've hit "${label}" ${count} times — consider adding a fix workflow`
        });
      }
    }

    return patterns;
  }

  // ── GET STATS ─────────────────────────────────────────────────────────────
  async getStats() {
    if (!this._graph) await this.load();

    const nodes       = Object.values(this._graph.nodes);
    const byType      = {};
    let   mostUsed    = null;

    for (const n of nodes) {
      byType[n.type] = (byType[n.type] || 0) + 1;
      if (!mostUsed || n.use_count > mostUsed.use_count) mostUsed = n;
    }

    return {
      total_nodes:  this._graph.stats.total_nodes,
      total_edges:  this._graph.stats.total_edges,
      by_type:      byType,
      most_used:    mostUsed?.label || null,
      last_recall:  this._graph.stats.last_recall,
      last_updated: this._graph.updated_at
    };
  }

  // ── SEARCH GRAPH ──────────────────────────────────────────────────────────
  async search(query) {
    const results = await this.recall(query, 10);
    return results.map(r => ({
      ...r.node,
      relevance_score: r.relevance,
      connections:     r.neighbours.length
    }));
  }

  // ── VISUALIZE (text tree) ─────────────────────────────────────────────────
  async visualize(nodeId = null) {
    if (!this._graph) await this.load();

    const nodes = nodeId
      ? [this._graph.nodes[nodeId]].filter(Boolean)
      : Object.values(this._graph.nodes).slice(0, 10);

    const lines = [];
    for (const node of nodes) {
      lines.push(`[${node.type.toUpperCase()}] ${node.label} (used: ${node.use_count})`);
      const neighbours = this._getNeighbours(node.id, 1);
      for (const n of neighbours.slice(0, 3)) {
        lines.push(`  └─ ${n.edge_type} → [${n.node.type}] ${n.node.label}`);
      }
    }
    return lines.join('\n');
  }

  // ── PRIVATE: INDEX NODE ───────────────────────────────────────────────────
  _indexNode(node) {
    const idx = this._graph.index;

    // by_type
    if (!idx.by_type[node.type]) idx.by_type[node.type] = [];
    idx.by_type[node.type].push(node.id);

    // by_tag
    for (const tag of (node.tags || [])) {
      if (!idx.by_tag[tag]) idx.by_tag[tag] = [];
      idx.by_tag[tag].push(node.id);
    }

    // by_text (inverted index)
    const words = node.label.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    for (const word of words) {
      if (!idx.by_text[word]) idx.by_text[word] = [];
      if (!idx.by_text[word].includes(node.id)) {
        idx.by_text[word].push(node.id);
      }
    }
  }

  // ── PRIVATE: FIND BY LABEL + TYPE ────────────────────────────────────────
  _findByLabelAndType(label, type) {
    return Object.values(this._graph.nodes).find(
      n => n.type === type && n.label.toLowerCase() === label.toLowerCase()
    ) || null;
  }

  // ── PRIVATE: GET LAST TASK NODE ───────────────────────────────────────────
  _getLastTaskNode() {
    const tasks = Object.values(this._graph.nodes)
      .filter(n => n.type === NODE_TYPES.TASK)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return tasks[1] || null; // [1] because [0] is the one just added
  }

  // ── PRIVATE: EXTRACT TAGS ─────────────────────────────────────────────────
  _extractTags(text) {
    const tags  = [];
    const lower = text.toLowerCase();
    const tagMap = {
      'git':    'git',   'npm':    'npm',    'node':   'node',
      'python': 'python','docker': 'docker', 'file':   'file',
      'build':  'build', 'deploy': 'deploy', 'test':   'test',
      'setup':  'setup', 'create': 'create', 'delete': 'delete',
      'api':    'api',   'server': 'server', 'install':'install'
    };
    for (const [keyword, tag] of Object.entries(tagMap)) {
      if (lower.includes(keyword)) tags.push(tag);
    }
    return [...new Set(tags)];
  }

  // ── PRIVATE: EXTRACT ENTITIES ─────────────────────────────────────────────
  _extractEntities(text) {
    const entities = [];
    // Extract quoted strings
    const quoted = text.match(/"([^"]+)"|'([^']+)'/g) || [];
    entities.push(...quoted.map(q => q.replace(/["']/g, '')));

    // Extract file paths
    const paths = text.match(/[\w.-]+\/[\w.-]+/g) || [];
    entities.push(...paths);

    // Extract known tools/commands
    const tools = ['git', 'npm', 'node', 'python', 'docker', 'curl', 'wget', 'ssh'];
    for (const tool of tools) {
      if (text.toLowerCase().includes(tool)) entities.push(tool);
    }

    return [...new Set(entities)].filter(e => e.length > 1);
  }

  // ── PRIVATE: NORMALIZE LABEL ──────────────────────────────────────────────
  _normalizeLabel(label) {
    return label.toLowerCase().replace(/\s+/g, ' ').trim();
  }
}

module.exports = { KnowledgeGraph, NODE_TYPES, EDGE_TYPES };
