'use strict';

const WebAgent  = require('./web.agent');
const FileAgent = require('./file.agent');
const CodeAgent = require('./code.agent');

// ─── AUTO ROUTER ──────────────────────────────────────────────────────────────
// The brain that decides which agent handles each task.
// Priority: explicit --agent flag > keyword matching > AI classification > fallback
//
// This is one of the most important parts of Tejas.
// As more agents are added, the router gets smarter.

class AgentRouter {
  constructor(aiEngine, memory) {
    this.ai      = aiEngine;
    this.memory  = memory;

    // Register all available agents
    this.agents = {
      web:      new WebAgent(aiEngine, memory),
      file:     new FileAgent(aiEngine, memory),
      code:     new CodeAgent(aiEngine, memory),
      workflow: null  // handled by existing run.js logic
    };
  }

  // ── ROUTE TASK ────────────────────────────────────────────────────────────
  // Returns ONLY the name of the best agent for this task.
  // The executor (run.js) will handle the actual execution.
  async route(task, options = {}, context = {}) {
    const agentName = await this._selectAgent(task, options, context);
    return { agent: agentName };
  }

  // ── SELECT AGENT ──────────────────────────────────────────────────────────
  async _selectAgent(task, options, context) {
    // 1. Explicit flag overrides everything
    if (options.agent && options.agent !== 'auto') {
      return options.agent;
    }

    // 2. Fast keyword matching (no AI call needed)
    const sysWords = ['close','open','kill','launch','start','stop','minimize','maximize'];
    const appWords = ['firefox','browser','terminal','chrome','chromium','nautilus','xterm','application','app','window'];
    const lt2 = task.toLowerCase();
    
    // System control
    if (sysWords.some(function(w) { return lt2.includes(w); }) &&
        appWords.some(function(w) { return lt2.includes(w); })) {
      return 'workflow';
    }

    // Math and version checks — MUST be workflow (shell)
    if (/(\d+)\s*[\+\-\*\/x]\s*(\d+)/i.test(task) || 
        /\b(version|check)\b/i.test(task) ||
        /\b(date|time)\b/i.test(task)) {
      return 'workflow';
    }

    // Agent keyword matching
    if (WebAgent.canHandle(task))  return 'web';
    if (CodeAgent.canHandle(task)) return 'code';
    if (FileAgent.canHandle(task)) return 'file';

    // 3. Check memory for similar past tasks
    try {
      const similar = await this.memory.graph.recall(task, 3);
      if (similar.length > 0) {
        const topNode = similar[0].node;
        if (topNode?.data?.agent && topNode.data.agent !== 'workflow') {
          // We've done something similar before — use same agent
          return topNode.data.agent;
        }
      }
    } catch {}

    // 4. AI classification for ambiguous tasks
    return this._aiClassify(task);
  }

  // ── AI CLASSIFY ───────────────────────────────────────────────────────────
  async _aiClassify(task) {
    const prompt = `
Classify this task into exactly ONE agent category. Respond with ONLY the agent name.

Task: "${task}"

Agents:
- web      → anything needing internet: search, fetch URL, live data, news, prices
- file     → anything about files/dirs: read, analyze, find, list, organize
- code     → anything about programming: write, review, fix, debug, test code
- workflow → everything else: shell commands, system tasks, git, npm, general automation

Reply with just one word: web, file, code, or workflow`;

    try {
      const response = await this.ai.call(prompt);
      const clean    = response.trim().toLowerCase().split('\n')[0];
      if (['web', 'file', 'code', 'workflow'].includes(clean)) {
        return clean;
      }
    } catch {}

    // Final fallback
    return 'workflow';
  }

  // ── GET AGENT INFO ────────────────────────────────────────────────────────
  getAgentList() {
    return [
      {
        name:        'web',
        status:      'active',
        description: 'Search web, fetch URLs, live data',
        triggers:    ['search', 'find online', 'fetch', 'latest', 'news']
      },
      {
        name:        'file',
        status:      'active',
        description: 'Read, analyze, organize files',
        triggers:    ['read', 'analyze file', 'find file', 'list', 'organize']
      },
      {
        name:        'code',
        status:      'active',
        description: 'Write, review, fix, debug code',
        triggers:    ['code', 'bug', 'review', 'fix', 'test', 'refactor']
      },
      {
        name:        'workflow',
        status:      'active',
        description: 'Shell commands, git, npm, system tasks',
        triggers:    ['run', 'execute', 'git', 'npm', 'install', 'setup']
      },
      {
        name:        'voice',
        status:      'planned',
        description: 'Natural voice interface — Tejas mode',
        triggers:    ['voice', 'speak', 'listen']
      },
      {
        name:        'clawdbot',
        status:      'planned',
        description: 'IoT, robotics, physical world control',
        triggers:    ['device', 'robot', 'iot', 'drone', 'sensor']
      }
    ];
  }

  // ── EXPLAIN ROUTING DECISION ──────────────────────────────────────────────
  async explainRouting(task) {
    const webScore  = WebAgent.canHandle(task)  ? 'keyword match' : 'no match';
    const codeScore = CodeAgent.canHandle(task) ? 'keyword match' : 'no match';
    const fileScore = FileAgent.canHandle(task) ? 'keyword match' : 'no match';

    return {
      task,
      routing: { web: webScore, code: codeScore, file: fileScore },
      selected: await this._selectAgent(task, {}, {})
    };
  }
}

module.exports = AgentRouter;
