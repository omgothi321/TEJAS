'use strict';

const axios = require('axios');

// ─── WEB AGENT ────────────────────────────────────────────────────────────────
// Gives Tejas eyes on the internet.
// Can: search web, fetch URLs, extract content, check APIs
// Used when task contains: search, find, lookup, fetch, scrape, check, latest

class WebAgent {
  constructor(aiEngine, memory) {
    this.ai     = aiEngine;
    this.memory = memory;
    this.name   = 'web';
    this.timeout = 15000;
  }

  // ── MAIN ENTRY ────────────────────────────────────────────────────────────
  async run(task, context = {}) {
    const result = {
      agent:   this.name,
      task,
      success: false,
      output:  null,
      steps:   [],
      error:   null
    };

    try {
      // Ask AI to decide: search or fetch?
      const plan = await this._planWebTask(task, context);

      for (const step of plan.steps) {
        const stepResult = await this._executeStep(step);
        result.steps.push(stepResult);
        if (!stepResult.success && step.critical) {
          result.error = stepResult.error;
          return result;
        }
      }

      // Synthesize all step outputs into final answer
      result.output  = await this._synthesize(task, result.steps);
      result.success = true;

    } catch (err) {
      result.error = err.message;
    }

    return result;
  }

  // ── PLAN WEB TASK ─────────────────────────────────────────────────────────
  async _planWebTask(task, context) {
    const prompt = `
You are Tejas Web Agent. Plan how to complete this web task.
Respond ONLY with valid JSON.

Task: "${task}"

Return:
{
  "steps": [
    {
      "type": "search|fetch|extract|api",
      "description": "what this step does",
      "query": "search query if type=search",
      "url": "URL if type=fetch or api",
      "extract": "what to extract from the page",
      "critical": true
    }
  ]
}`;

    const raw  = await this.ai.call(prompt);
    return this.ai._parseJSON(raw);
  }

  // ── EXECUTE STEP ──────────────────────────────────────────────────────────
  async _executeStep(step) {
    const result = {
      type:    step.type,
      success: false,
      output:  null,
      error:   null
    };

    try {
      switch (step.type) {
        case 'search':
          result.output = await this._search(step.query);
          break;
        case 'fetch':
          result.output = await this._fetch(step.url);
          break;
        case 'extract':
          result.output = step.extract
            ? `Extracted: ${step.extract} from previous content`
            : 'No extraction target specified';
          break;
        case 'api':
          result.output = await this._callAPI(step.url);
          break;
        default:
          result.output = `[Unknown web step: ${step.type}]`;
      }
      result.success = true;
    } catch (err) {
      result.error = err.message;
    }

    return result;
  }

  // ── SEARCH (DuckDuckGo instant answers - no key needed) ───────────────────
  async _search(query) {
    // Try Tavily first (best quality)
    try {
      const tavily = await this._searchTavily(query);
      if (tavily) return tavily;
    } catch {}

    if (!query) throw new Error('No search query provided');

    try {
      // DuckDuckGo Instant Answer API — completely free, no key
      const encoded = encodeURIComponent(query);
      const res = await axios.get(
        `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`,
        { timeout: this.timeout }
      );

      const data      = res.data;
      const results   = [];

      if (data.AbstractText) {
        results.push(`Summary: ${data.AbstractText}`);
      }

      if (data.Answer) {
        results.push(`Direct Answer: ${data.Answer}`);
      }

      if (data.RelatedTopics && data.RelatedTopics.length > 0) {
        const topics = data.RelatedTopics
          .slice(0, 5)
          .filter(t => t.Text)
          .map(t => `• ${t.Text}`);
        if (topics.length > 0) {
          results.push(`Related:\n${topics.join('\n')}`);
        }
      }

      if (results.length === 0) {
        return `Search completed for "${query}" — no instant answer available. Try a more specific query.`;
      }

      return results.join('\n\n');

    } catch (err) {
      // Fallback response if search fails
      return `Search attempted for "${query}" — connection issue. Result: Unable to fetch live data. Check your internet connection.`;
    }
  }

  // ── FETCH URL ─────────────────────────────────────────────────────────────
  async _fetch(url) {
    if (!url) throw new Error('No URL provided');

    // Basic URL validation
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    try {
      const res = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'User-Agent': 'Tejas-Agent/1.0 (AI Operating System)'
        },
        maxContentLength: 500000 // 500KB max
      });

      const content = typeof res.data === 'string'
        ? res.data
        : JSON.stringify(res.data);

      // Strip HTML tags for clean text
      const clean = content
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 3000); // first 3000 chars

      return `Content from ${url}:\n${clean}`;

    } catch (err) {
      if (err.response) {
        throw new Error(`HTTP ${err.response.status} from ${url}`);
      }
      throw new Error(`Cannot fetch ${url}: ${err.message}`);
    }
  }

  // ── CALL API ──────────────────────────────────────────────────────────────
  async _callAPI(url) {
    if (!url) throw new Error('No API URL provided');

    try {
      const res = await axios.get(url, {
        timeout: this.timeout,
        headers: { 'Accept': 'application/json' }
      });
      return typeof res.data === 'object'
        ? JSON.stringify(res.data, null, 2).slice(0, 2000)
        : String(res.data).slice(0, 2000);
    } catch (err) {
      throw new Error(`API call failed: ${err.message}`);
    }
  }

  // ── SYNTHESIZE RESULTS ────────────────────────────────────────────────────
  async _synthesize(task, steps) {
    const successfulOutputs = steps
      .filter(s => s.success && s.output)
      .map(s => s.output)
      .join('\n\n---\n\n');

    if (!successfulOutputs) return 'No web data retrieved.';

    const prompt = `
You are Tejas. Synthesize these web results into a clear, direct answer.
Be concise. Be accurate. No fluff.

Original task: "${task}"

Web data:
${successfulOutputs.slice(0, 4000)}

Give a direct answer in 2-5 sentences.`;

    try {
      return await this.ai.call(prompt);
    } catch {
      return successfulOutputs.slice(0, 500);
    }
  }

  // ── CAPABILITY CHECK ──────────────────────────────────────────────────────
  static canHandle(task) {
    const triggers = [
      'search web', 'search online', 'find online', 'look up online',
      'fetch url', 'scrape', 'latest news', 'news today',
      'website', 'http://', 'https://', 'www.',
      'stock price', 'weather in', 'crypto price'
    ];
    const lower = task.toLowerCase();
    return triggers.some(t => lower.includes(t));
  }
}

module.exports = WebAgent;
