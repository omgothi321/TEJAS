'use strict';

const inquirer      = require('inquirer');
const chalk         = require('chalk');
const MemoryManager = require('../core/memory');
const display       = require('../utils/display');
const fs            = require('fs-extra');
const path          = require('path');

// ─── MEMORY COMMAND ───────────────────────────────────────────────────────────
module.exports = async function memoryCommand(options) {
  const memory = new MemoryManager(process.cwd());

  if (!await memory.exists()) {
    display.error('Tejas not initialized. Run: tejas init');
    process.exit(1);
  }

  // ── LIST ──────────────────────────────────────────────────────────────────
  if (options.list) {
    const mem = await memory.read();
    display.section('Tejas Memory Entries');
    display.br();

    // Workflows
    if (mem.knowledge.workflows.length > 0) {
      display.info(chalk.bold('Workflows:'));
      mem.knowledge.workflows.forEach(w => {
        console.log(chalk.gray(`  - ${w.name}: ${w.description} (Trigger: ${w.trigger})`));
      });
      display.br();
    }

    // Patterns
    if (mem.knowledge.patterns.length > 0) {
      display.info(chalk.bold('Patterns:'));
      mem.knowledge.patterns.forEach(p => {
        console.log(chalk.gray(`  - ${p.name}: ${p.value}`));
      });
      display.br();
    }

    // Commands
    if (mem.knowledge.commands.length > 0) {
      display.info(chalk.bold('Commands:'));
      mem.knowledge.commands.forEach(c => {
        console.log(chalk.gray(`  - ${c.name}: ${c.command} (${c.description})`));
      });
      display.br();
    }

    // Shortcuts
    const shortcuts = Object.keys(mem.user.shortcuts);
    if (shortcuts.length > 0) {
      display.info(chalk.bold('Shortcuts:'));
      shortcuts.forEach(s => {
        console.log(chalk.gray(`  - ${s}: ${mem.user.shortcuts[s]}`));
      });
      display.br();
    }

    // History (last 5)
    if (mem.agents.history.length > 0) {
      display.info(chalk.bold('Recent Tasks:'));
      mem.agents.history.slice(0, 5).forEach(h => {
        console.log(chalk.gray(`  - ${h.timestamp.split('T')[0]}: ${h.task} [${h.success ? '✓' : '✗'}]`));
      });
      display.br();
    }

    if (mem.knowledge.workflows.length === 0 && mem.knowledge.patterns.length === 0 &&
        mem.knowledge.commands.length === 0 && shortcuts.length === 0 && mem.agents.history.length === 0) {
      display.info('No memory entries yet. Run: tejas learn "some pattern"');
    }
    return;
  }

  // ── SEARCH ────────────────────────────────────────────────────────────────
  if (options.search) {
    const results = await memory.search(options.search);
    display.section(`Memory Search: "${options.search}"`);
    display.br();
    if (results.length === 0) {
      display.info('No results found.');
      return;
    }
    results.forEach(r => {
      let line = chalk.gray(`[${r.type}] `);
      if (r.type === 'workflow') {
        line += chalk.white(`${r.name}: ${r.description} (Trigger: ${r.trigger})`);
      } else if (r.type === 'pattern') {
        line += chalk.white(`${r.name}: ${r.value}`);
      } else if (r.type === 'history') {
        line += chalk.white(`${r.task} (${r.timestamp.split('T')[0]})`);
      }
      console.log(line);
    });
    display.br();
    return;
  }

  // ── EXPORT ────────────────────────────────────────────────────────────────
  if (options.export) {
    const filePath = path.resolve(options.export);
    await memory.export(filePath);
    display.success(`Memory exported to: ${filePath}`);
    return;
  }

  // ── IMPORT ────────────────────────────────────────────────────────────────
  if (options.import) {
    const filePath = path.resolve(options.import);
    if (!await fs.pathExists(filePath)) {
      display.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    await memory.import(filePath);
    display.success(`Memory imported from: ${filePath}`);
    return;
  }

  // ── CLEAR ─────────────────────────────────────────────────────────────────
  if (options.clear) {
    const { confirmed } = await inquirer.prompt([{
      type:    'confirm',
      name:    'confirmed',
      message: chalk.red('Clear ALL Tejas memory? This is irreversible.'),
      default: false
    }]);
    if (confirmed) {
      await memory.clear();
      display.success('Tejas memory cleared.');
    }
    return;
  }

  // If no options, show help
  if (Object.keys(options).length === 0) {
    console.log(chalk.gray('  Run ') + chalk.cyan('tejas memory --help') + chalk.gray(' for usage.'));
  }
};
