'use strict';

const chalk         = require('chalk');
const MemoryManager = require('../core/memory');
const display       = require('../utils/display');

// ─── STATUS COMMAND ───────────────────────────────────────────────────────────
module.exports = async function status(options) {
  const memory = new MemoryManager(process.cwd());

  if (!await memory.exists()) {
    display.error('Tejas not initialized in this directory.');
    display.info('Run: tejas init');
    return;
  }

  await memory.initialize();
  const mem    = await memory.read();
  const config = await memory.readConfig();

  // ── Project Info ──
  display.section('Tejas System Status');
  display.br();

  display.table(['Field', 'Value'], [
    ['Project',     chalk.cyan(mem.project.name || '—')],
    ['Type',        chalk.cyan(mem.project.type || '—')],
    ['User',        chalk.cyan(mem.user.name || '—')],
    ['AI Model',    chalk.cyan(config.model || '—')],
    ['OS',          chalk.gray(mem.world_model.os || process.platform)],
    ['Memory File', chalk.gray('.tejas/memory.json')],
    ['Initialized', chalk.gray(mem.created_at?.split('T')[0] || '—')],
    ['Last Active', chalk.gray(mem.agents.last_active?.split('T')[0] || 'Never')]
  ]);

  // ── Memory Stats ──
  display.memoryStats(mem);

  // ── Knowledge ──
  display.section('Knowledge Graph');
  let graphStats = null;
  try {
    graphStats = await memory.getGraphStats();
  } catch {}

  display.table(['Category', 'Count'], [
    ['Graph Nodes',   chalk.yellow(graphStats?.total_nodes ?? '—')],
    ['Graph Edges',   chalk.yellow(graphStats?.total_edges ?? '—')],
    ['Most Used',     chalk.cyan(graphStats?.most_used ?? '—')],
    ['Workflows',     chalk.yellow(mem.knowledge.workflows.length)],
    ['Patterns',      chalk.yellow(mem.knowledge.patterns.length)],
    ['Commands',      chalk.yellow(mem.knowledge.commands.length)],
    ['Shortcuts',     chalk.yellow(Object.keys(mem.user.shortcuts || {}).length)],
    ['Preferences',   chalk.yellow(Object.keys(mem.user.preferences || {}).length)]
  ]);

  // ── API Keys Status ──
  display.section('API Keys');
  const keys = config.api_keys || {};
  display.table(['Model', 'Status'], [
    ['Groq',     keys.groq     ? chalk.green('✓ Active')     : chalk.red('✗ Not set')],
    ['Gemini',   keys.gemini   ? chalk.green('✓ Active')     : chalk.red('✗ Not set')],
    ['Tavily',   keys.tavily   ? chalk.green('✓ Active')     : chalk.yellow('○ Optional')],
    ['xAI',      keys.xai      ? chalk.green('✓ Active')     : chalk.yellow('○ Optional')],
    ['Claude',   keys.claude   ? chalk.green('✓ Active')     : chalk.yellow('○ Optional')],
    ['DeepSeek', keys.deepseek ? chalk.green('✓ Active')     : chalk.yellow('○ Optional')],
    ['OpenAI',   keys.openai   ? chalk.green('✓ Active')     : chalk.yellow('○ Optional')],
    ['Ollama',   chalk.gray(keys.ollama_url || 'http://localhost:11434')]
  ]);

  // ── Recent History ──
  if (mem.agents.history.length > 0) {
    display.section('Recent Tasks');
    const rows = mem.agents.history.slice(0, 5).map(h => [
      chalk.gray(h.timestamp?.split('T')[0] || '—'),
      chalk.white(h.task?.slice(0, 40) || '—'),
      h.success ? chalk.green('✓') : chalk.red('✗')
    ]);
    display.table(['Date', 'Task', 'Result'], rows);
  }

  // ── Tools ──
  if (mem.world_model.tools?.length > 0) {
    display.section('Available Tools');
    display.dim(mem.world_model.tools.join('  |  '));
  }

  // ── Full dump ──
  if (options.full) {
    display.section('Full Memory Dump');
    console.log(chalk.gray(JSON.stringify(mem, null, 2)));
  }

  display.br();

  // ── Quick actions ──
  console.log(chalk.gray('  Quick actions:'));
  console.log(chalk.gray('  ') + chalk.cyan('tejas run "<task>"') + chalk.gray('    — execute a task'));
  console.log(chalk.gray('  ') + chalk.cyan('tejas memory --list') + chalk.gray('  — browse memory'));
  console.log(chalk.gray('  ') + chalk.cyan('tejas config --list') + chalk.gray('  — view config'));
  display.br();
};
