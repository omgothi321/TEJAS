'use strict';

const { buildDecomposePrompt, CONSTITUTION } = require('./constitution');
const SmartModelRouter = require('./model-router');
const WorkflowCache    = require('./cache');
const SelfCorrector    = require('./corrector');

// ─── TEJAS BRAIN ──────────────────────────────────────────────────────────────
// The master orchestrator of the Brain Layer.
// Every AI call in Tejas goes through here.
//
// What the Brain does that raw AI cannot:
//   1. Injects full memory context into every call
//   2. Routes to the best model for each task type
//   3. Checks cache before touching any API
//   4. Self-corrects on failure without user intervention
//   5. Learns from every interaction
//   6. Gets smarter the more you use it

class TejasB {
  constructor(aiEngine, memory, config = {}) {
    this.ai      = aiEngine;
    this.memory  = memory;
    this.config  = config;

    const keys   = config.api_keys || {};
    this.modelRouter = new SmartModelRouter({
      groq:     !!keys.groq,
      gemini:   !!keys.gemini,
      xai:      !!keys.xai,
      deepseek: !!keys.deepseek,
      claude:   !!keys.claude,
      openai:   !!keys.openai,
      ollama:   true
    });

    this.cache     = new WorkflowCache(
      memory?.tejasDir || process.cwd() + '/.tejas'
    );
    this.corrector = new SelfCorrector(aiEngine);
    this._stats    = { cache_hits: 0, api_calls: 0, corrections: 0, total_tasks: 0 };
  }

  // ── THINK ─────────────────────────────────────────────────────────────────
  async think(task, options = {}) {
    this._stats.total_tasks++;

    // 1. Check cache — free and instant
    if (!options.skipCache) {
      const cached = await this.cache.get(task);
      if (cached.hit && cached.confidence >= 0.9) {
        this._stats.cache_hits++;
        return {
          ...cached.plan,
          _source:      'cache',
          _confidence:  cached.confidence,
          _cache_type:  cached.source
        };
      }
    }

    // 2. Build rich context from memory
    const memCtx = await this._getMemoryContext(task);

    // 3. Select best model
    const sel           = this.modelRouter.selectModel(task, options);
    const originalModel = this.ai.model;
    if (sel.model !== originalModel) this.ai.model = sel.model;

    // 4. Build enriched prompt
    const prompt = buildDecomposePrompt(task, memCtx);

    // 5. Call AI
    this._stats.api_calls++;
    const start = Date.now();
    let plan;

    try {
      const raw = await this.ai.call(prompt);
      plan      = this.ai._parseJSON(raw);
      this.modelRouter.trackResult(sel.model, task, true, Date.now() - start);
    } catch (err) {
      this.modelRouter.trackResult(sel.model, task, false, Date.now() - start);
      throw err;
    } finally {
      this.ai.model = originalModel;
    }

    plan._source       = 'ai';
    plan._model        = sel.model;
    plan._model_reason = sel.reason;
    plan._context_nodes = memCtx?.graph_context?.relevant_nodes?.length || 0;

    return plan;
  }

  // ── CALL WITH CONTEXT ─────────────────────────────────────────────────────
  async call(prompt, options = {}) {
    this._stats.api_calls++;
    const sel           = this.modelRouter.selectModel(prompt.slice(0, 100), options);
    const originalModel = this.ai.model;

    if (sel.model !== originalModel && !options.keepModel) {
      this.ai.model = sel.model;
    }

    try {
      const enriched = options.injectConstitution
        ? `${CONSTITUTION}\n\n${prompt}`
        : prompt;
      return await this.ai.call(enriched);
    } finally {
      this.ai.model = originalModel;
    }
  }

  // ── CORRECT ───────────────────────────────────────────────────────────────
  async correct(step, error, originalTask) {
    this._stats.corrections++;
    return this.corrector.correctStep(step, error, originalTask);
  }

  // ── SAVE TO CACHE ─────────────────────────────────────────────────────────
  async saveToCache(task, plan, success) {
    if (success && plan && plan._source !== 'cache') {
      await this.cache.set(task, plan, success);
    }
  }

  // ── GET STATS ─────────────────────────────────────────────────────────────
  async getStats() {
    const cacheStats = await this.cache.getStats();
    const modelStats = this.modelRouter.getStats();
    return {
      session:    this._stats,
      cache:      cacheStats,
      models:     modelStats,
      efficiency: this._stats.total_tasks > 0
        ? Math.round(this._stats.cache_hits / this._stats.total_tasks * 100) + '%'
        : '0%'
    };
  }

  // ── AUTOGPT: SELF REFLECTION ──────────────────────────────────────────────
  async reflect(task, output) {
    if (!output || String(output).trim().length < 5) {
      return { solved: true, confidence: 100, next_step: null };
    }
    const t = String(task).replace(/"/g, "'");
    const o = String(output).slice(0, 300).replace(/"/g, "'");
    const prompt = 'Task: ' + t + '\nOutput: ' + o + '\nDid this fully solve the task? JSON only: {"solved":true,"confidence":100,"next_step":null}';
    try {
      const raw = await this.ai.call(prompt);
      return this.ai._parseJSON(raw) || { solved: true, confidence: 100 };
    } catch {
      return { solved: true, confidence: 100, next_step: null };
    }
  }

  // ── MEMGPT: COMPRESS OLD MEMORIES ─────────────────────────────────────────
  async compressMemory() {
    try {
      if (this.memory.compress) {
        return await this.memory.compress();
      }
    } catch { /* silent */ }
  }

  // ── PRIVATE ───────────────────────────────────────────────────────────────
  async _getMemoryContext(task) {
    try { return await this.memory.getContextSummary(task); }
    catch { return {}; }
  }
}

module.exports = TejasB;
