'use strict';

const { buildDecomposePrompt, CONSTITUTION } = require('./constitution');
const SmartModelRouter = require('./model-router');
const WorkflowCache    = require('./cache');
const SelfCorrector    = require('./corrector');

// ─── TEJAS BRAIN ──────────────────────────────────────────────────────────────
// Master orchestrator.
// Injects memory, routes models, caches workflows, corrects failures.
// Fixed by multi-AI council: Claude + Grok + ChatGPT + Gemini

class TejasB {
  constructor(aiEngine, memory, config = {}) {
    this.ai     = aiEngine;
    this.memory = memory;
    this.config = config;

    const keys = config.api_keys || {};
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
      (memory && memory.tejasDir) || process.cwd() + '/.tejas'
    );
    this.corrector = new SelfCorrector(aiEngine);
    this._stats    = {
      cache_hits:  0,
      api_calls:   0,
      corrections: 0,
      total_tasks: 0
    };
  }

  // ── THINK ─────────────────────────────────────────────────────────────────
  async think(task, options) {
    options = options || {};
    this._stats.total_tasks++;

    // 1. Cache check — instant, free
    if (!options.skipCache) {
      const cached = await this.cache.get(task);
      if (cached && cached.hit && cached.confidence >= 0.9) {
        this._stats.cache_hits++;
        return Object.assign({}, cached.plan, {
          _source:     'cache',
          _confidence: cached.confidence,
          _cache_type: cached.source
        });
      }
    }

    // 2. Memory context
    let memCtx = {};
    try {
      memCtx = await this._getMemoryContext(task) || {};
    } catch (err) {
      if (this.config.verbose) console.warn('[Brain] Memory context retrieval failed:', err.message);
    }

    // 3. Model selection
    const sel           = this.modelRouter.selectModel(task, options);
    const originalModel = this.ai.model;
    if (sel.model !== originalModel) this.ai.model = sel.model;

    // 4. Build prompt
    const prompt = buildDecomposePrompt(task, memCtx);

    // 5. AI call + SAFE parsing (Grok audit fix)
    this._stats.api_calls++;
    const start = Date.now();
    let plan  = null;

    try {
      const raw = await this.ai.call(prompt);
      plan    = this.ai._parseJSON(raw);

      // ── CRITICAL SAFETY GUARD ─────────────────────────────────────────────
      // plan could be null, array, string, or non-object if AI returns bad JSON
      // Throw here so catch block handles it cleanly
      if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
        throw new Error('AI returned invalid plan structure: ' + typeof plan);
      }

      // Safe property assignment
      plan._source        = 'ai';
      plan._model         = sel.model         || 'unknown';
      plan._model_reason  = sel.reason        || 'auto-selected';
      plan._context_nodes = (memCtx &&
                             memCtx.graph_context &&
                             memCtx.graph_context.relevant_nodes)
                            ? memCtx.graph_context.relevant_nodes.length
                            : 0;

      this.modelRouter.trackResult(sel.model, task, true, Date.now() - start);

    } catch (err) {
      this.modelRouter.trackResult(sel.model, task, false, Date.now() - start);
      throw err;
    } finally {
      this.ai.model = originalModel;
    }

    return plan;
  }

  // ── CALL WITH CONTEXT ─────────────────────────────────────────────────────
  async call(prompt, options) {
    options = options || {};
    this._stats.api_calls++;
    const sel           = this.modelRouter.selectModel(
      prompt.slice(0, 100), options
    );
    const originalModel = this.ai.model;

    if (sel.model !== originalModel && !options.keepModel) {
      this.ai.model = sel.model;
    }

    try {
      const enriched = options.injectConstitution
        ? CONSTITUTION + '\n\n' + prompt
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
        ? Math.round(
            this._stats.cache_hits / this._stats.total_tasks * 100
          ) + '%'
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
    const prompt = 'Task: ' + t +
      '\nOutput: ' + o +
      '\nDid this fully solve the task? ' +
      'JSON only: {"solved":true,"confidence":100,"next_step":null}';
    try {
      const raw    = await this.ai.call(prompt);
      const result = this.ai._parseJSON(raw);
      return result || { solved: true, confidence: 100, next_step: null };
    } catch (err) {
      if (this.config.verbose) console.warn('[Brain] Reflection failed:', err.message);
      return { solved: false, confidence: 0, next_step: 'retry' };
    }
  }

  // ── MEMGPT: COMPRESS OLD MEMORIES ─────────────────────────────────────────
  async compressMemory() {
    try {
      if (this.memory && this.memory.compress) {
        return await this.memory.compress();
      }
    } catch (err) { 
      if (this.config.verbose) console.warn('[Brain] Memory compression failed:', err.message);
    }
  }

  // ── PRIVATE ───────────────────────────────────────────────────────────────
  async _getMemoryContext(task) {
    try {
      return await this.memory.getContextSummary(task);
    } catch (err) {
      if (this.config.verbose) console.warn('[Brain] _getMemoryContext failed:', err.message);
      return {};
    }
  }
}

module.exports = TejasB;
