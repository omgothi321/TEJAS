'use strict';

const fs   = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const EmbeddingService = require('../core/embeddings');

class WorkflowCache {
  constructor(tejasDir, db, embeddings) {
    this.tejasDir  = tejasDir;
    this.cacheFile = path.join(tejasDir, 'workflow-cache.json');
    this.db        = db;
    this.embeddings = embeddings;
    this.HIT_THRESHOLD = 0.92; // High threshold for cache hits
  }

  async migrate() {
    if (!await fs.pathExists(this.cacheFile)) return;
    
    console.log('[Cache] Migrating JSON cache to SQLite...');
    const oldCache = await fs.readJson(this.cacheFile);
    
    for (const [key, entry] of Object.entries(oldCache.entries || {})) {
      let embedding = null;
      try { embedding = await this.embeddings.embed(entry.original || key); } catch (err) {}

      this.db.db.prepare(`
        INSERT OR REPLACE INTO cache (id, task, embedding, plan, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        uuidv4(),
        entry.original || key,
        embedding ? Buffer.from(embedding.buffer) : null,
        JSON.stringify(entry.plan),
        entry.cached_at ? Math.floor(new Date(entry.cached_at).getTime() / 1000) : Math.floor(Date.now() / 1000)
      );
    }

    await fs.rename(this.cacheFile, this.cacheFile + '.bak');
    console.log('[Cache] Migration complete.');
  }

  async get(task) {
    let queryVec = null;
    try { queryVec = await this.embeddings.embed(task); } catch (err) {}
    if (!queryVec) return { hit: false };

    // Pre-filter: only cache entries with embeddings, ordered by recency
    // Limit cosine scan to top 100 candidates
    const cached = this.db.db.prepare(`
      SELECT * FROM cache 
      WHERE embedding IS NOT NULL 
      ORDER BY created_at DESC LIMIT 100
    `).all();

    let best = { hit: false, score: -1 };

    for (const entry of cached) {
      const entryVec = new Float32Array(entry.embedding.buffer, entry.embedding.byteOffset, entry.embedding.byteLength / 4);
      const score = EmbeddingService.cosineSimilarity(queryVec, entryVec);
      
      if (score > best.score && score >= this.HIT_THRESHOLD) {
        best = { hit: true, plan: JSON.parse(entry.plan), score, source: 'semantic' };
      }
    }

    if (best.hit) {
      return { hit: true, plan: best.plan, confidence: best.score, source: best.source };
    }

    return { hit: false };
  }

  async set(task, plan, success) {
    if (!success) return;

    let embedding = null;
    try { embedding = await this.embeddings.embed(task); } catch (err) {}

    this.db.db.prepare(`
      INSERT OR REPLACE INTO cache (id, task, embedding, plan)
      VALUES (?, ?, ?, ?)
    `).run(
      uuidv4(),
      task,
      embedding ? Buffer.from(embedding.buffer) : null,
      JSON.stringify(plan)
    );
  }

  async invalidate(task) {
    this.db.db.prepare("DELETE FROM cache WHERE task = ?").run(task);
  }

  async getStats() {
    const row = this.db.db.prepare("SELECT count(*) as count FROM cache").get();
    return {
      cached_workflows: row.count,
      total_hits: 'N/A', // need to add hits tracking to schema if desired
    };
  }
}

module.exports = WorkflowCache;
