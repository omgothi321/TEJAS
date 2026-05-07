'use strict';

const WebAgent  = require('./web.agent');
const FileAgent = require('./file.agent');
const CodeAgent = require('./code.agent');
const IntentParser = require('../core/intent');

// ─── TEJAS SMART ROUTER v3.0 ──────────────────────────────────────────────────
// Now powered by IntentParser (AI Brain) + Scoring Fallback (Logic)

class AgentRouter {
  constructor(aiEngine, memory) {
    this.ai     = aiEngine;
    this.memory = memory;
    this.parser = new IntentParser(aiEngine);

    this.agents = {
      workflow: { name: 'workflow' },
      code:     new CodeAgent(aiEngine, memory),
      file:     new FileAgent(aiEngine, memory),
      web:      new WebAgent(aiEngine, memory),
      robotics: { name: 'robotics' }
    };

    this.priority = ['robotics', 'code', 'workflow', 'file', 'web'];
  }

  // ── ROUTE TASK ────────────────────────────────────────────────────────────
  async route(task, options = {}, context = {}) {
    // 1. AI INTENT PARSING
    const aiIntent = await this.parser.parse(task);
    
    // Debug mode: Show what the AI thinks
    if (process.env.TEJAS_DEBUG === '1') {
      console.log(`\n[Brain] Intent: ${aiIntent.intent} (${Math.round(aiIntent.confidence * 100)}%)`);
      console.log(`[Brain] Reasoning: ${aiIntent.reasoning}`);
    }

    // 2. Explicit flag overrides
    if (options && options.agent && options.agent !== 'auto') {
      const useNative = ['workflow', 'robotics'].includes(options.agent);
      return { agent: options.agent, useNativeExecutor: useNative, entities: aiIntent.entities };
    }

    // 3. SCORING (Hybrid Approach)
    const scores = this._calculateScores(task);
    
    // Boost score based on AI Intent
    if (aiIntent.intent === 'web.search') scores.web += 50;
    if (aiIntent.intent === 'file.operation') scores.file += 50;
    if (aiIntent.intent === 'code.task') scores.code += 50;

    const winner   = this._selectWinner(scores);

    // 4. EXECUTION
    if (winner === 'workflow' || winner === 'robotics') {
      return { agent: winner, useNativeExecutor: true, entities: aiIntent.entities };
    }

    var agent = this.agents[winner];
    if (!agent || !agent.run) {
      return { agent: 'workflow', useNativeExecutor: true, entities: aiIntent.entities };
    }

    // Pass AI entities to the agent for better automation
    var result = await agent.run(task, { ...context, entities: aiIntent.entities });
    return { agent: winner, useNativeExecutor: false, result: result };
  }

  // ── CALCULATE ALL SCORES ──────────────────────────────────────────────────
  _calculateScores(task) {
    var scores = {};
    var self   = this;

    // workflow and robotics scored internally
    scores.workflow = self._scoreWorkflow(task);
    scores.robotics = self._scoreRobotics(task);

    // other agents scored by their own getScore() if available
    ['code', 'file', 'web'].forEach(function(name) {
      var agent = self.agents[name];
      if (agent && agent.getScore) {
        scores[name] = agent.getScore(task);
      } else if (agent && agent.constructor && agent.constructor.canHandle) {
        scores[name] = agent.constructor.canHandle(task) ? 5 : 0;
      } else {
        scores[name] = 0;
      }
    });

    return scores;
  }

  // ── SELECT WINNER ─────────────────────────────────────────────────────────
  _selectWinner(scores) {
    var self   = this;
    var maxScore = Math.max.apply(null, Object.values(scores));

    // All zero → safe fallback
    if (maxScore === 0) return 'workflow';

    // Sort by score DESC, then by priority ASC for ties
    var entries = Object.keys(scores).map(function(name) {
      return { name: name, score: scores[name] };
    });

    entries.sort(function(a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return self.priority.indexOf(a.name) - self.priority.indexOf(b.name);
    });

    return entries[0].name;
  }

  // ── WORKFLOW SCORER ───────────────────────────────────────────────────────
  // Math, system info, shell commands, time, app control
  _scoreWorkflow(task) {
    var score = 0;
    var lt    = task.toLowerCase();

    // Math — highest priority (return early)
    if (/\d+\s*[\+\-\*\/x]\s*\d+/i.test(task)) return 95;

    // System info queries
    if (/\b(disk\s+space|cpu\s+usage|memory\s+usage|ip\s+address|hostname|uptime)\b/i.test(lt)) score += 85;

    // Version checks
    if (/\b(version|node\s+version|python\s+version)\b/i.test(lt)) score += 85;

    // Time and date — not for web queries
    if (/\b(time|clock|date|today)\b/i.test(lt)) {
      if (!/(weather|capital|population|who\s+is)/.test(lt)) score += 75;
    }

    // App control
    var sysWords = ['close', 'kill', 'stop', 'minimize', 'launch'];
    var appWords = ['firefox', 'browser', 'terminal', 'chrome',
                    'chromium', 'nautilus', 'xterm', 'window'];
    var hasSys = sysWords.some(function(w) { return lt.includes(w); });
    var hasApp = appWords.some(function(w) { return lt.includes(w); });
    if (hasSys && hasApp) score += 85;

    // Running processes
    if (/\b(running|processes|applications|apps\s+running)\b/i.test(lt)) score += 75;

    // General check commands
    if (/\bcheck\b/i.test(lt) && !/(code|file|syntax|write|create)/.test(lt)) score += 50;

    return score;
  }

  // ── ROBOTICS SCORER — TejasArm ────────────────────────────────────────────
  // Physical world control — always wins when detected
  _scoreRobotics(task) {
    const lt = task.toLowerCase();
    const roboticsTriggers = [
      'move arm', 'rotate joint', 'tejasarm', 'pick object',
      'drop object', 'gpio', 'sensor', 'robot control',
      'physical world', 'raspberry pi pin', 'arduino',
      'servo motor', 'stepper motor', 'motor control'
    ];
    if (roboticsTriggers.some(function(t) { return lt.includes(t); })) {
      return 98; // Physical safety = always highest
    }
    return 0;
  }

  // ── AGENT INFO ────────────────────────────────────────────────────────────
  getAgentList() {
    return [
      { name: 'robotics', status: 'planned', description: 'TejasArm — physical world control' },
      { name: 'code',     status: 'active',  description: 'Write scripts, functions, programs' },
      { name: 'workflow', status: 'active',  description: 'Shell, math, system, time, version' },
      { name: 'file',     status: 'active',  description: 'Read, create, list, find files' },
      { name: 'web',      status: 'active',  description: 'Search, news, weather, facts' }
    ];
  }

  // ── EXPLAIN ROUTING ───────────────────────────────────────────────────────
  async explainRouting(task) {
    var scores   = this._calculateScores(task);
    var selected = this._selectWinner(scores);
    return { task: task, scores: scores, selected: selected };
  }
}

module.exports = AgentRouter;
