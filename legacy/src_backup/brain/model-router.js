'use strict';

// ─── SMART MODEL ROUTER ───────────────────────────────────────────────────────
// Tejas uses multiple AI models. Each one is best at different things.
// This router picks the right brain for each task automatically.
//
// Model strengths:
//   Groq (Llama 3.3 70B) → best speed, great reasoning, free
//   Gemini Flash          → best for web/search tasks, huge context, free
//   xAI Grok             → great at analysis and current events, $175 free
//   DeepSeek             → best at code generation, very cheap
//   Ollama               → fully offline, no cost, slower

const ROUTING_RULES = [
  // Code tasks → DeepSeek (specialized for code) or Groq
  {
    name:     'code',
    triggers: ['write code', 'function', 'script', 'debug', 'fix bug',
                'review code', 'refactor', 'implement', 'algorithm'],
    prefer:   ['deepseek', 'groq', 'gemini'],
    reason:   'Code specialized models produce better code'
  },
  // Web/search tasks → Gemini (huge context, web-aware)
  {
    name:     'web',
    triggers: ['search', 'find online', 'latest', 'current', 'news',
                'fetch', 'url', 'website', 'today', 'price', 'weather'],
    prefer:   ['gemini', 'groq', 'xai'],
    reason:   'Gemini has best web awareness and large context'
  },
  // Analysis/reasoning → xAI or Groq
  {
    name:     'analysis',
    triggers: ['analyze', 'explain', 'understand', 'why', 'compare',
                'review', 'evaluate', 'assess', 'research'],
    prefer:   ['xai', 'groq', 'gemini'],
    reason:   'xAI and Groq excel at deep reasoning'
  },
  // Quick/simple tasks → Groq (fastest free)
  {
    name:     'quick',
    triggers: ['create file', 'make directory', 'git', 'npm install',
                'run', 'execute', 'list', 'show', 'print'],
    prefer:   ['groq', 'gemini', 'ollama'],
    reason:   'Fast models for simple operations'
  },
  // Offline/private tasks → Ollama
  {
    name:     'private',
    triggers: ['private', 'offline', 'local', 'no internet', 'secret'],
    prefer:   ['ollama', 'groq'],
    reason:   'Local models for privacy-sensitive tasks'
  }
];

class SmartModelRouter {
  constructor(availableModels = {}) {
    // availableModels = { groq: true, gemini: true, xai: false, deepseek: false, ollama: false }
    this.available = availableModels;
    this._history  = []; // track which models worked
  }

  // ── SELECT MODEL FOR TASK ─────────────────────────────────────────────────
  selectModel(task, options = {}) {
    // 1. Explicit override
    if (options.model && this.available[options.model]) {
      return { model: options.model, reason: 'explicit override' };
    }

    // 2. Match routing rules
    const lower = task.toLowerCase();
    for (const rule of ROUTING_RULES) {
      const matched = rule.triggers.some(t => lower.includes(t));
      if (matched) {
        // Find first available preferred model
        for (const preferred of rule.prefer) {
          if (this.available[preferred]) {
            return {
              model:  preferred,
              rule:   rule.name,
              reason: rule.reason
            };
          }
        }
      }
    }

    // 3. Default: first available model
    const defaultModel = this._getDefaultModel();
    return { model: defaultModel, reason: 'default model' };
  }

  // ── GET DEFAULT MODEL ─────────────────────────────────────────────────────
  _getDefaultModel() {
    // Priority order for default
    const priority = ['groq', 'gemini', 'xai', 'deepseek', 'claude', 'openai', 'ollama'];
    for (const m of priority) {
      if (this.available[m]) return m;
    }
    return 'ollama'; // last resort
  }

  // ── TRACK RESULT ──────────────────────────────────────────────────────────
  trackResult(model, task, success, latencyMs) {
    this._history.push({
      model, task: task.slice(0, 50), success, latencyMs,
      ts: new Date().toISOString()
    });
    // Keep last 100
    if (this._history.length > 100) this._history.shift();
  }

  // ── GET STATS ─────────────────────────────────────────────────────────────
  getStats() {
    const byModel = {};
    for (const entry of this._history) {
      if (!byModel[entry.model]) {
        byModel[entry.model] = { calls: 0, success: 0, totalMs: 0 };
      }
      byModel[entry.model].calls++;
      if (entry.success) byModel[entry.model].success++;
      byModel[entry.model].totalMs += entry.latencyMs;
    }

    return Object.entries(byModel).map(([model, stats]) => ({
      model,
      calls:       stats.calls,
      success_rate: Math.round((stats.success / stats.calls) * 100) + '%',
      avg_ms:       Math.round(stats.totalMs / stats.calls)
    }));
  }
}

module.exports = SmartModelRouter;
