'use strict';

const inquirer      = require('inquirer');
const chalk         = require('chalk');
const MemoryManager = require('../core/memory');
const display       = require('../utils/display');

// ─── MEMORY COMMAND ───────────────────────────────────────────────────────────
module.exports = async function memoryCmd(options) {
  const memory = new MemoryManager(process.cwd());

  if (!await memory.exists()) {
    display.error('Tejas not initialized. Run: tejas init');
    process.exit(1);
  }

  await memory.initialize();

  // ── LIST ──────────────────────────────────────────────────────────────────
  if (options.show || options.list) {
    const mem = await memory.read();
    display.section('Memory Contents');

    if (mem.knowledge.workflows.length > 0) {
      display.section('Workflows');
      mem.knowledge.workflows.forEach(w => {
        console.log(chalk.cyan(`  • ${w.name}`) + chalk.gray(` — ${w.description || w.trigger || '—'}`));
      });
    }

    if (mem.knowledge.patterns.length > 0) {
      display.section('Patterns');
      mem.knowledge.patterns.forEach(p => {
        console.log(chalk.yellow(`  • ${p.name}`) + chalk.gray(` = ${p.value || '—'}`));
      });
    }

    if (Object.keys(mem.user.shortcuts || {}).length > 0) {
      display.section('Shortcuts');
      Object.entries(mem.user.shortcuts).forEach(([alias, cmd]) => {
        console.log(chalk.magenta(`  • ${alias}`) + chalk.gray(` → ${cmd}`));
      });
    }

    if (Object.keys(mem.user.preferences || {}).length > 0) {
      display.section('Preferences');
      Object.entries(mem.user.preferences).forEach(([k, v]) => {
        console.log(chalk.white(`  • ${k}`) + chalk.gray(` = ${v}`));
      });
    }

    display.br();
    return;
  }

  // ── SEARCH ────────────────────────────────────────────────────────────────
  if (options.search) {
    const results = await memory.search(options.search);
    display.section(`Search: "${options.search}"`);
    if (results.length === 0) {
      display.warn('No results found.');
    } else {
      results.forEach(r => {
        console.log(chalk.cyan(`  [${r.type}] `) + chalk.white(r.label || r.task || '—'));
        if (r.description) display.dim(r.description);
      });
    }
    display.br();
    return;
  }

  // ── EXPORT ────────────────────────────────────────────────────────────────
  if (options.export) {
    const spin = display.spinner('Exporting memory...').start();
    await memory.export(options.export);
    spin.succeed(chalk.green(`Memory exported to: ${options.export}`));
    return;
  }

  // ── IMPORT ────────────────────────────────────────────────────────────────
  if (options.import) {
    const { confirmed } = await inquirer.prompt([{
      type:    'confirm',
      name:    'confirmed',
      message: `Import from ${options.import}? This will overwrite current memory.`,
      default: false
    }]);
    if (confirmed) {
      await memory.import(options.import);
      display.success(`Memory imported from: ${options.import}`);
    }
    return;
  }

  // ── CLEAR ─────────────────────────────────────────────────────────────────
  if (options.clear) {
    const { confirmed } = await inquirer.prompt([{
      type:    'confirm',
      name:    'confirmed',
      message: chalk.red('Clear ALL memory? This cannot be undone.'),
      default: false
    }]);
    if (confirmed) {
      await memory.clear();
      display.success('Memory cleared. Tejas starts fresh.');
    }
    return;
  }

  // ── DEFAULT: show help ────────────────────────────────────────────────────
  display.info('Use --list, --search, --export, --import, or --clear');
};
