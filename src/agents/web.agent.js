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
We have access to Tavily Advanced Search which provides direct answers and high-quality snippets.

For complex research, prefer 1-2 comprehensive "search" steps over many "fetch" steps, unless a specific URL is provided.
Avoid planning steps for sites with heavy bot protection (like Google Scholar or Arxiv) if a general search can find the info.

Task: "${task}"

Return ONLY valid JSON:
{
  "steps": [
    {
      "type": "search|fetch|api",
      "description": "short description",
      "query": "comprehensive search query if type=search",
      "url": "exact URL if type=fetch or api",
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

  // ── SEARCH (Tavily Advanced Search + DDG Fallback) ────────────────────────
  async _search(query) {
    if (!query) throw new Error('No search query provided');

    // 1. Try Tavily (Best quality, advanced reasoning)
    try {
      const tavilyResult = await this._searchTavily(query);
      if (tavilyResult) return tavilyResult;
    } catch (err) {
      if (this.ai.verbose) console.log(`  [Web] Tavily failed, falling back: ${err.message}`);
    }

    // 2. Fallback to DuckDuckGo (Free, no key)
    return this._searchDuckDuckGo(query);
  }

  // ── TAVILY SEARCH ─────────────────────────────────────────────────────────
  async _searchTavily(query) {
    const apiKey = this.ai.apiKeys?.tavily || process.env.TAVILY_API_KEY;
    if (!apiKey) return null;

    try {
      const res = await axios.post('https://api.tavily.com/search', {
        api_key: apiKey,
        query: query,
        search_depth: 'advanced',
        include_answer: true,
        max_results: 5
      }, { timeout: 10000 });

      const data = res.data;
      if (!data) return null;

      let output = '';
      
      // If Tavily provided a direct answer, use it
      if (data.answer) {
        output += `AI Answer: ${data.answer}\n\n`;
      }

      // Add top results
      if (data.results && data.results.length > 0) {
        output += 'Search Results:\n';
        data.results.forEach((r, i) => {
          output += `[${i+1}] ${r.title}\n    URL: ${r.url}\n    Snippet: ${r.content.slice(0, 200)}...\n\n`;
        });
      }

      return output || null;
    } catch (err) {
      throw new Error(`Tavily search failed: ${err.message}`);
    }
  }

  // ── DUCKDUCKGO SEARCH ─────────────────────────────────────────────────────
  async _searchDuckDuckGo(query) {
    try {
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
      return `Search failed for "${query}" (DuckDuckGo fallback). Error: ${err.message}`;
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


  // ── SCORING FUNCTION ──────────────────────────────────────────────────────
  getScore(task) {
    var t = task.toLowerCase();
    var s = 0;

    // Explicit search
    if (/\bsearch\s+(for\s+|the\s+)?(latest|online|web)\b/i.test(t)) s += 80;
    if (/\bsearch\s+(for\s+)?\w+/i.test(t)) s += 70;

    // News
    if (/\b(latest\s+news|news\s+today|current\s+news)\b/i.test(t)) s += 75;

    // Geography facts
    if (/\bcapital\s+of\b/i.test(t)) s += 80;
    if (/\bweather\s+in\b/i.test(t)) s += 85;
    if (/\b(population|president|prime\s+minister|ceo)\s+(of|is)\b/i.test(t)) s += 70;

    // Stock/crypto
    if (/\b(stock\s+price|crypto|bitcoin|exchange\s+rate)\b/i.test(t)) s += 75;

    // URL
    if (/https?:\/\//i.test(t)) s += 90;
    if (/\bwww\.\b/i.test(t)) s += 80;

    // NEVER steal local system tasks
    if (/\b(version|ip\s+address|disk\s+space|running|close|time\s+in)\b/i.test(t)) s = 0;

    return Math.max(0, s);
  }

  // ── CAPABILITY CHECK ──────────────────────────────────────────────────────
  static canHandle(task) {
    const triggers = [
      'search ', 'search for', 'search latest', 'search online',
      'find online', 'look up online', 'look up the',
      'fetch url', 'scrape website', 'latest news', 'news today',
      'what is the capital', 'what is the population',
      'weather in ', 'stock price', 'crypto price',
      'http://', 'https://', 'www.',
      'who is the president', 'who is the ceo',
      'current news', 'recent news'
    ];
    const lower = task.toLowerCase();
    return triggers.some(function(t) { return lower.includes(t); });
  }
}

module.exports = WebAgent;
