'use strict';

const chalk         = require('chalk');
const inquirer      = require('inquirer');
const MemoryManager = require('../core/memory');
const AIEngine      = require('../core/ai');
const AgentRouter   = require('../agents/router');
const TejasB        = require('../brain/brain');
const Executor      = require('../core/executor');
const display       = require('../utils/display');
const CriticAgent   = require('../agents/critic.agent');

// ─── IDENTITY TRIGGERS ────────────────────────────────────────────────────────
const IDENTITY_TRIGGERS = [
  'who are you', 'what are you',
  'introduce yourself', 'what is tejas',
  'your name', 'about yourself',
  'tell me about you'
];

// ─── RUN COMMAND ──────────────────────────────────────────────────────────────
module.exports = async function run(task, options) {
  // Validate input
  if (!task || typeof task !== 'string' || task.trim().length === 0) {
    display.error('Please provide a task. Example: tejas run "create a file"');
    return;
  }

  task = task.trim();
  options = options || {};

  // Setup
  const memory = new MemoryManager(process.cwd());

  if (!await memory.exists()) {
    display.error('Tejas not initialized here. Run: tejas init');
    process.exit(1);
  }

  // Initialize state & models
  await memory.initialize();

  const config   = await memory.readConfig();
  const ai       = new AIEngine({ ...config, verbose: options.verbose || false });
  const router   = new AgentRouter(ai, memory);
  const brain    = new TejasB(ai, memory, config);
  const critic   = new CriticAgent(ai);
  const executor = new Executor({ verbose: options.verbose || false, cwd: process.cwd() });

  // ── IDENTITY SHORTCUT ────────────────────────────────────────────────────────
  const taskLower = task.toLowerCase();
  if (IDENTITY_TRIGGERS.some(function(t) { return taskLower.includes(t); })) {
    try {
      const mem   = await memory.read();
      const nodes = mem && mem.graph && mem.graph.nodes
                    ? Object.keys(mem.graph.nodes).length : 0;
      const tasks = mem && mem.stats ? mem.stats.tasks_run || 0 : 0;
      console.log(chalk.cyan([
        '',
        '  ╔══════════════════════════════════════════╗',
        '  ║           ◈ I AM TEJAS v2.0.0            ║',
        '  ║     AI + Robotics Operating System       ║',
        '  ╠══════════════════════════════════════════╣',
        '  ║  Brain:    Groq Llama 3.3 70B            ║',
        '  ║  Backup:   Gemini 2.0 Flash              ║',
        '  ║  Search:   Tavily AI-Native              ║',
        '  ║  Voice:    Piper TTS + Groq Whisper      ║',
        '  ╠══════════════════════════════════════════╣',
        '  ║  Agents:   File Code Web System Critic   ║',
        '  ║  Memory:   ' + String(nodes).padEnd(6) + ' nodes learned        ║',
        '  ║  Tasks:    ' + String(tasks).padEnd(6) + ' completed            ║',
        '  ║  Status:   All systems operational       ║',
        '  ╠══════════════════════════════════════════╣',
        '  ║  Absorbed: AutoGPT MemGPT CrewAI         ║',
        '  ║            LangChain Cursor Perplexity   ║',
        '  ║            Lemon OpenClaw Tavily Judge   ║',
        '  ╚══════════════════════════════════════════╝',
        ''
      ].join('\n')));
    } catch {
      console.log(chalk.cyan('  I am Tejas v2.0.0 — AI + Robotics Operating System'));
    }
    return;
  }

  // ── DISPLAY TASK ──────────────────────────────────────────────────────────────
  display.section('Running Task');
  display.info(chalk.bold(task));
  display.br();

  const spin = display.spinner('Thinking...').start();

  try {
    // ── BRAIN THINKS ────────────────────────────────────────────────────────────
    let plan = null;
    try {
      plan = await brain.think(task, {
        model:     options.model     || null,
        skipCache: options.skipCache || false
      });
    } catch {
      // Brain failed — will use ai.decomposeTask below
    }

    // ── ROUTE ───────────────────────────────────────────────────────────────────
    let routing = null;
    try {
      routing = await router.route(task);
    } catch {
      routing = { agent: 'workflow', useNativeExecutor: true };
    }

    spin.stop();

    // ── AGENT PATH (file/code/web) ───────────────────────────────────────────────
    if (routing && !routing.useNativeExecutor && routing.result) {
      // Router already executed the agent and returned result
      const result = routing.result;

      if (result && result.output) {
        console.log('\n' + result.output + '\n');
      }

      // Show timing
      const duration = result && result.duration ? result.duration : 0;
      const success  = result && result.success;

      if (success) {
        display.success('✓ [' + routing.agent + '] [' + duration + 'ms]');
      } else {
        display.error('✗ [' + routing.agent + '] — ' + (result && result.error ? result.error : 'failed'));
      }

      // Judge quality — never crashes
      try {
        const out = result && result.output ? String(result.output) : '';
        if (out.length > 10) {
          const judgment = await critic.judge(task, out, routing.agent);
          critic.display(judgment);
        }
      } catch { /* silent */ }

      // Log to memory — uses object format that memory.js expects
      try {
        await memory.logTask({
          task:          task,
          agent:         routing.agent,
          steps:         1,
          success:       success || false,
          duration_ms:   duration,
          plan_summary:  task,
          error_message: success ? null : (result && result.error ? result.error : 'failed')
        });
      } catch { /* silent */ }

      // Save to brain cache
      try {
        await brain.saveToCache(task, { steps: [] }, success || false);
      } catch { /* silent */ }

      display.br();
      return;
    }

    // ── NATIVE EXECUTOR PATH (workflow/system) ───────────────────────────────────
    // Get or create plan
    if (!plan || !plan.steps || plan.steps.length === 0) {
      const spinPlan = display.spinner('Planning...').start();
      try {
        const context = await memory.getContextSummary(task);
        plan = await ai.decomposeTask(task, context);
        spinPlan.stop();
      } catch (e) {
        spinPlan.stop();
        display.error('Could not plan task: ' + e.message);
        display.info('Check API key: tejas config --list');
        return;
      }
    }

    if (!plan || !plan.steps || plan.steps.length === 0) {
      display.error('Could not create execution plan');
      return;
    }

    // Show plan
    display.agentPlan(plan);

    // Dry run — stop here
    if (options.dryRun) {
      display.info('Dry run — not executing');
      return;
    }

    // Confirm if needed
    const hasShell = plan.steps.some(function(s) { return s.action === 'shell'; });
    if (plan.requires_confirmation || hasShell) {
      try {
        const answer = await inquirer.prompt([{
          type:    'confirm',
          name:    'confirmed',
          message: 'Execute ' + plan.steps.length + ' steps?',
          default: true
        }]);
        if (!answer.confirmed) {
          display.warn('Task cancelled.');
          return;
        }
      } catch {
        // Non-interactive — auto confirm
      }
    }

    display.br();

    // Execute
    const execSpin = display.spinner('Executing steps...').start();
    let results = [];

    try {
      results = await executor.runSteps(plan.steps, function(step, result) {
        execSpin.stop();
        display.stepResult(step, result);
        
        // ALWAYS SHOW OUTPUT FOR SHELL ACTIONS
        if (result.output && String(result.output).trim().length > 0) {
          console.log(chalk.gray('      ↳ ') + chalk.white(String(result.output).replace(/\n/g, '\n        ')));
        }
        
        execSpin.start();
      });
      execSpin.stop();
    } catch (e) {
      execSpin.stop();
      display.error('Execution error: ' + e.message);
    }

    // Summary
    const passed  = results.filter(function(r) { return r && r.success; }).length;
    const failed  = results.filter(function(r) { return r && !r.success; }).length;
    const totalMs = results.reduce(function(s, r) { return s + (r && r.duration_ms ? r.duration_ms : 0); }, 0);

    display.br();
    if (failed === 0) {
      display.success('All ' + passed + ' steps completed in ' + totalMs + 'ms');
    } else {
      display.warn(passed + ' succeeded, ' + failed + ' failed');
    }

    // Show learned pattern
    if (plan.memory_update && plan.memory_update.should_learn && plan.memory_update.pattern_name) {
      display.success('Learned new pattern: "' + plan.memory_update.pattern_name + '"');
    }

    // Judge quality
    try {
      const allOutput = results
        .map(function(r) { return r && r.output ? String(r.output) : ''; })
        .join('\n')
        .trim();
      if (allOutput.length > 10) {
        const judgment = await critic.judge(task, allOutput, plan.agent || 'workflow');
        critic.display(judgment);
      }
    } catch { /* silent */ }

    // Log to memory — correct object format
    try {
      await memory.logTask({
        task:          task,
        agent:         plan.agent || 'workflow',
        steps:         plan.steps.length,
        steps_detail:  plan.steps,
        success:       failed === 0,
        duration_ms:   totalMs,
        plan_summary:  plan.understood_as || task,
        error_message: failed > 0
          ? (results.find(function(r) { return r && r.error; }) || {}).error || null
          : null
      });
    } catch { /* silent */ }

    // Auto-learn workflow
    if (plan.memory_update && plan.memory_update.should_learn &&
        config.preferences && config.preferences.auto_learn !== false) {
      try {
        await memory.addWorkflow({
          name:        plan.memory_update.pattern_name,
          trigger:     task,
          description: plan.understood_as || task,
          steps:       plan.steps,
          agent:       plan.agent || 'workflow'
        });
        display.success('Auto-learned: "' + plan.memory_update.pattern_name + '"');
      } catch { /* silent — non-interactive */ }
    }

    // Brain cache
    try {
      await brain.saveToCache(task, plan, failed === 0);
    } catch { /* silent */ }

    // Verbose brain stats
    if (options.verbose) {
      try {
        const stats = await brain.getStats();
        console.log(chalk.gray('\n  Brain stats: ' + JSON.stringify(stats)));
      } catch {}
    }

    display.br();

  } catch (e) {
    spin.stop();
    display.error('Run failed: ' + e.message);
    if (options.verbose) {
      console.error(e);
    }
  }
};
