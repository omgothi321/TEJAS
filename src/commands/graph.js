'use strict';

const chalk         = require('chalk');
const MemoryManager = require('../core/memory');
const display       = require('../utils/display');

// ─── GRAPH COMMAND ────────────────────────────────────────────────────────────
module.exports = async function graph(options) {
  const memory = new MemoryManager(process.cwd());

  if (!await memory.exists()) {
    display.error('Tejas not initialized. Run: tejas init');
    process.exit(1);
  }

  await memory.initialize();

  // ── STATS ──────────────────────────────────────────────────────────────────
  if (options.stats || (!options.search && !options.visualize && !options.patterns && !options.recall)) {
    const spin = display.spinner('Reading knowledge graph...').start();
    const stats = await memory.getGraphStats();
    spin.stop();

    display.section('Knowledge Graph Stats');
    display.table(['Metric', 'Value'], [
      ['Total Nodes',  chalk.yellow(stats.total_nodes)],
      ['Total Edges',  chalk.yellow(stats.total_edges)],
      ['Most Used',    chalk.cyan(stats.most_used || '—')],
      ['Last Recall',  chalk.gray(stats.last_recall ? stats.last_recall.split('T')[0] : 'Never')],
      ['Last Updated', chalk.gray(stats.last_updated ? stats.last_updated.split('T')[0] : '—')]
    ]);

    if (stats.by_type && Object.keys(stats.by_type).length > 0) {
      display.section('Nodes by Type');
      display.table(
        ['Type', 'Count'],
        Object.entries(stats.by_type).map(([type, count]) => [
          chalk.cyan(type),
          chalk.yellow(count)
        ])
      );
    }

    display.br();
    console.log(chalk.gray('  Commands:'));
    console.log(chalk.gray('  ') + chalk.cyan('tejas graph --visualize') + chalk.gray('        — see node tree'));
    console.log(chalk.gray('  ') + chalk.cyan('tejas graph --patterns') + chalk.gray('         — detect habits'));
    console.log(chalk.gray('  ') + chalk.cyan('tejas graph --recall "<query>"') + chalk.gray('  — smart memory lookup'));
    console.log(chalk.gray('  ') + chalk.cyan('tejas graph --search "<query>"') + chalk.gray('  — search all nodes'));
    display.br();
    return;
  }

  // ── VISUALIZE ──────────────────────────────────────────────────────────────
  if (options.visualize) {
    const spin = display.spinner('Rendering graph...').start();
    const tree = await memory.graphVisualize();
    spin.stop();

    display.section('Knowledge Graph — Node Tree');
    console.log('');
    console.log(chalk.gray(tree));
    display.br();
    return;
  }

  // ── PATTERNS ──────────────────────────────────────────────────────────────
  if (options.patterns) {
    const spin = display.spinner('Detecting patterns...').start();
    const patterns = await memory.findPatterns();
    spin.stop();

    display.section('Detected Patterns');

    if (patterns.length === 0) {
      display.info('No patterns detected yet. Run more tasks and check back.');
      return;
    }

    patterns.forEach(p => {
      const icon = p.type === 'recurring_error' ? chalk.red('⚠') : chalk.green('↻');
      console.log(`\n  ${icon} ${chalk.bold(p.type.replace('_', ' ').toUpperCase())}`);
      console.log(chalk.gray(`    Task:  `) + chalk.white(p.label));
      console.log(chalk.gray(`    Count: `) + chalk.yellow(p.count));
      console.log(chalk.gray(`    Tip:   `) + chalk.cyan(p.suggestion));
    });

    display.br();
    return;
  }

  // ── RECALL ────────────────────────────────────────────────────────────────
  if (options.recall) {
    const spin = display.spinner(`Recalling: "${options.recall}"...`).start();
    const results = await memory.graph.recall(options.recall, 8);
    spin.stop();

    display.section(`Graph Recall — "${options.recall}"`);

    if (results.length === 0) {
      display.warn('Nothing found. Run some tasks first to build the graph.');
      return;
    }

    results.forEach((r, i) => {
      const score = Math.round(r.relevance * 100) / 100;
      console.log(
        chalk.gray(`\n  ${i + 1}. `) +
        chalk.bold.white(r.node.label) +
        chalk.gray(` [${r.node.type}]`) +
        chalk.yellow(` score: ${score}`)
      );
      if (r.neighbours.length > 0) {
        r.neighbours.slice(0, 2).forEach(n => {
          console.log(
            chalk.gray(`     └─ ${n.edge_type} → `) +
            chalk.cyan(`[${n.node.type}] ${n.node.label}`)
          );
        });
      }
    });

    display.br();
    return;
  }

  // ── SEARCH ────────────────────────────────────────────────────────────────
  if (options.search) {
    const spin = display.spinner(`Searching: "${options.search}"...`).start();
    const results = await memory.graphSearch(options.search);
    spin.stop();

    display.section(`Graph Search — "${options.search}"`);

    if (results.length === 0) {
      display.warn('No nodes found matching that query.');
      return;
    }

    display.table(
      ['Type', 'Label', 'Used', 'Score', 'Connections'],
      results.map(r => [
        chalk.cyan(r.type),
        chalk.white(r.label.slice(0, 40)),
        chalk.gray(r.use_count || 1),
        chalk.yellow(Math.round((r.relevance_score || 0) * 100) / 100),
        chalk.gray(r.connections || 0)
      ])
    );

    display.br();
    return;
  }
};
