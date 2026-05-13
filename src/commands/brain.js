'use strict';

const chalk         = require('chalk');
const Table         = require('cli-table3');
const MemoryManager = require('../core/memory');
const AIEngine      = require('../core/ai');
const TejasB        = require('../brain/brain');
const WorkflowCache = require('../brain/cache');
const display       = require('../utils/display');
const path          = require('path');

// ─── BRAIN COMMAND ────────────────────────────────────────────────────────────
// tejas brain --stats      → show brain performance
// tejas brain --cache      → list cached workflows
// tejas brain --flush      → clear cache
// tejas brain --models     → show model routing stats
// tejas brain --test       → test all connected models

module.exports = async function brain(options) {
  const memory = new MemoryManager(process.cwd());

  if (!await memory.exists()) {
    display.error('Tejas not initialized here. Run: tejas init');
    process.exit(1);
  }

  await memory.initialize();

  const config = await memory.readConfig();
  const ai     = new AIEngine(config);
  const b      = new TejasB(ai, memory, config);
  const cache  = new WorkflowCache(path.join(process.cwd(), '.tejas'), memory.db, memory.embeddings);

  // ── STATS ──────────────────────────────────────────────────────────────
  if (options.stats || (!options.cache && !options.flush && !options.models && !options.test)) {
    display.section('Tejas Brain Layer');
    display.br();

    // Constitution
    console.log(chalk.bold.magenta('  ◈ Constitution'));
    console.log(chalk.gray('    Identity + rules injected into every AI call'));
    console.log(chalk.gray('    Enforces: precision, no hallucination, security-first'));
    display.br();

    // Cache stats
    const cStats = await cache.getStats();
    console.log(chalk.bold.cyan('  ◈ Workflow Cache'));
    console.log(chalk.gray(`    Cached workflows:  `) + chalk.white(cStats.cached_workflows));
    console.log(chalk.gray(`    Total cache hits:  `) + chalk.white(cStats.total_hits));
    console.log(chalk.gray(`    Cache hit rate:    `) + chalk.green(cStats.hit_rate || '0%'));
    if (cStats.most_used) {
      console.log(chalk.gray(`    Most used:         `) + chalk.white(cStats.most_used));
    }
    display.br();

    // Model routing
    const keys = config.api_keys || {};
    const models = [
      { name: 'Groq (Llama 3.3 70B)', key: 'groq',     best_for: 'Speed, general tasks' },
      { name: 'Gemini Flash',          key: 'gemini',   best_for: 'Web, large context'   },
      { name: 'xAI Grok',             key: 'xai',      best_for: 'Analysis, reasoning'  },
      { name: 'DeepSeek',             key: 'deepseek', best_for: 'Code generation'       },
      { name: 'Claude',               key: 'claude',   best_for: 'Complex reasoning'     },
      { name: 'Ollama (local)',        key: 'ollama',   best_for: 'Offline, private'      },
    ];

    console.log(chalk.bold.yellow('  ◈ Smart Model Router'));
    for (const m of models) {
      const connected = !!keys[m.key];
      const icon      = connected ? chalk.green('✓') : chalk.gray('○');
      const status    = connected ? chalk.white(m.name) : chalk.gray(m.name);
      console.log(`    ${icon} ${status} ${chalk.gray('→ ' + m.best_for)}`);
    }
    display.br();

    // Self-corrector
    console.log(chalk.bold.red('  ◈ Self-Corrector'));
    console.log(chalk.gray('    Auto-retries failed tasks with error context'));
    console.log(chalk.gray('    Max retries: 2 per step'));
    display.br();

    // Graph
    const gStats = await memory.getGraphStats();
    console.log(chalk.bold.white('  ◈ Knowledge Graph'));
    console.log(chalk.gray(`    Nodes: `) + chalk.white(gStats.total_nodes || 0));
    console.log(chalk.gray(`    Edges: `) + chalk.white(gStats.total_edges || 0));
    console.log(chalk.gray('    Grows with every task — Tejas learns you'));
    display.br();
    return;
  }

  // ── CACHE LIST ────────────────────────────────────────────────────────────
  if (options.cache) {
    display.section('Cached Workflows');
    display.br();
    const list = await cache.list();
    if (list.length === 0) {
      display.info('No workflows cached yet. Run tasks and they will be cached automatically.');
      return;
    }
    const table = new Table({
      head:  [chalk.cyan('Task'), chalk.cyan('Created')],
      style: { head: [], border: ['gray'] }
    });
    for (const w of list) {
      table.push([
        w.task.slice(0, 50),
        chalk.gray(w.created_at ? new Date(w.created_at * 1000).toISOString().split('T')[0] : '—')
      ]);
    }
    console.log(table.toString());
    display.br();
    return;
  }

  // ── FLUSH CACHE ───────────────────────────────────────────────────────────
  if (options.flush) {
    memory.db.db.prepare('DELETE FROM cache').run();
    display.success('Workflow cache cleared.');
    return;
  }

  // ── TEST MODELS ───────────────────────────────────────────────────────────
  if (options.test) {
    display.section('Testing AI Models');
    display.br();
    const testPrompt = 'Reply with exactly: TEJAS_OK';
    const modelList  = ['groq', 'gemini', 'xai', 'deepseek', 'claude', 'ollama'];

    for (const m of modelList) {
      const keys = config.api_keys || {};
      if (!keys[m] && m !== 'ollama') {
        console.log(chalk.gray(`  ○ ${m.padEnd(12)} — no key configured`));
        continue;
      }
      const spin = ora({ text: chalk.gray(`  Testing ${m}...`), spinner: 'dots' }).start();
      try {
        const start = Date.now();
        const res   = await ai.call(testPrompt, null, { model: m });
        const ms    = Date.now() - start;
        spin.stop();
        const ok = res.includes('TEJAS_OK');
        console.log(
          (ok ? chalk.green('  ✓ ') : chalk.yellow('  ? ')) +
          chalk.white(m.padEnd(12)) +
          chalk.gray(` ${ms}ms`) +
          (ok ? '' : chalk.gray(' — ' + res.slice(0, 40)))
        );
      } catch (err) {
        spin.stop();
        console.log(chalk.red('  ✗ ') + chalk.gray(m.padEnd(12)) + chalk.red(err.message.slice(0, 60)));
      }
    }
    display.br();
  }
};

// Lazy require for ora
function ora(opts) {
  try { return require('ora')(opts); }
  catch { return { start() { return this; }, stop() {} }; }
}
