'use strict';

const fs   = require('fs-extra');
const path = require('path');

// ─── WORKFLOW CACHE ───────────────────────────────────────────────────────────
// The smarter Tejas gets, the less it needs AI.
// When Tejas has seen a task before and it worked — it executes instantly.
// No API call. No latency. No cost. Pure speed.
//
// This is the compound effect in action:
//   First time:    AI thinks for 2 seconds → executes → saves
//   Second time:   Cache hit → executes instantly (0ms AI call)
//   100th time:    Still instant — Tejas owns this workflow forever

class WorkflowCache {
  constructor(tejasDir) {
    this.cacheFile  = path.join(tejasDir, 'workflow-cache.json');
    this._cache     = null;
    this.HIT_THRESHOLD = 0.85; // similarity score to count as cache hit
  }

  // ── LOAD ──────────────────────────────────────────────────────────────────
  async load() {
    if (this._cache) return;
    if (await fs.pathExists(this.cacheFile)) {
      this._cache = await fs.readJson(this.cacheFile);
    } else {
      this._cache = { version: '1.0', entries: {}, stats: { hits: 0, misses: 0 } };
    }
  }

  // ── SAVE ──────────────────────────────────────────────────────────────────
  async _save() {
    await fs.writeJson(this.cacheFile, this._cache, { spaces: 2 });
  }

  // ── CHECK CACHE ───────────────────────────────────────────────────────────
  // Returns cached plan if task matches a known workflow
  async get(task) {
    await this.load();

    const key   = this._normalize(task);
    const entry = this._cache.entries[key];

    if (entry) {
      // Exact match
      entry.hits++;
      entry.last_used = new Date().toISOString();
      this._cache.stats.hits++;
      await this._save();
      return { hit: true, plan: entry.plan, confidence: 1.0, source: 'exact' };
    }

    // Fuzzy match — find similar cached task
    const fuzzy = this._fuzzyMatch(key);
    if (fuzzy) {
      this._cache.stats.hits++;
      await this._save();
      return { hit: true, plan: fuzzy.plan, confidence: fuzzy.score, source: 'fuzzy' };
    }

    this._cache.stats.misses++;
    return { hit: false };
  }

  // ── STORE IN CACHE ────────────────────────────────────────────────────────
  async set(task, plan, success) {
    await this.load();
    if (!success) return; // Only cache successful executions

    const key = this._normalize(task);
    this._cache.entries[key] = {
      original:   task,
      plan,
      hits:       0,
      success:    true,
      cached_at:  new Date().toISOString(),
      last_used:  new Date().toISOString()
    };
    await this._save();
  }

  // ── INVALIDATE ────────────────────────────────────────────────────────────
  async invalidate(task) {
    await this.load();
    const key = this._normalize(task);
    delete this._cache.entries[key];
    await this._save();
  }

  // ── GET STATS ─────────────────────────────────────────────────────────────
  async getStats() {
    await this.load();
    const entries   = Object.values(this._cache.entries);
    const totalHits = entries.reduce((s, e) => s + e.hits, 0);
    return {
      cached_workflows: entries.length,
      total_hits:       this._cache.stats.hits,
      total_misses:     this._cache.stats.misses,
      hit_rate:         this._cache.stats.hits + this._cache.stats.misses > 0
        ? Math.round(this._cache.stats.hits / (this._cache.stats.hits + this._cache.stats.misses) * 100) + '%'
        : '0%',
      most_used: entries.sort((a, b) => b.hits - a.hits)[0]?.original || null
    };
  }

  // ── LIST ALL ──────────────────────────────────────────────────────────────
  async list() {
    await this.load();
    return Object.values(this._cache.entries)
      .sort((a, b) => b.hits - a.hits)
      .map(e => ({
        task:      e.original,
        hits:      e.hits,
        cached_at: e.cached_at,
        last_used: e.last_used
      }));
  }

  // ── NORMALIZE TASK KEY ────────────────────────────────────────────────────
  _normalize(task) {
    return task
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }

  // ── FUZZY MATCH ───────────────────────────────────────────────────────────
  _fuzzyMatch(key) {
    const keyWords  = new Set(key.split(' ').filter(w => w.length > 3));
    let   bestMatch = null;
    let   bestScore = 0;

    for (const [cachedKey, entry] of Object.entries(this._cache.entries)) {
      const cachedWords = new Set(cachedKey.split(' ').filter(w => w.length > 3));
      const intersection = [...keyWords].filter(w => cachedWords.has(w)).length;
      const union        = new Set([...keyWords, ...cachedWords]).size;
      const score        = union > 0 ? intersection / union : 0;

      if (score > bestScore && score >= this.HIT_THRESHOLD) {
        bestScore = score;
        bestMatch = entry;
      }
    }

    return bestMatch ? { plan: bestMatch.plan, score: bestScore } : null;
  }
}

module.exports = WorkflowCache;
