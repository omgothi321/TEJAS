'use strict';

const inquirer      = require('inquirer');
const chalk         = require('chalk');
const MemoryManager = require('../core/memory');
const display       = require('../utils/display');

// ─── CONFIG COMMAND ───────────────────────────────────────────────────────────
module.exports = async function config(options) {
  const memory = new MemoryManager(process.cwd());

  const hasInit = await memory.exists();

  // ── LIST ──────────────────────────────────────────────────────────────────
  if (options.list || (!options.set && !options.get && !options.reset)) {
    if (!hasInit) { display.error('Not initialized. Run: tejas init'); return; }
    const conf = await memory.readConfig();
    display.section('Tejas Configuration');

    // Mask API keys
    const safe = JSON.parse(JSON.stringify(conf));
    if (safe.api_keys) {
      Object.keys(safe.api_keys).forEach(k => {
        if (safe.api_keys[k] && typeof safe.api_keys[k] === 'string' && safe.api_keys[k].length > 8) {
          safe.api_keys[k] = safe.api_keys[k].slice(0, 6) + '••••••••' + safe.api_keys[k].slice(-4);
        }
      });
    }

    console.log(chalk.gray(JSON.stringify(safe, null, 2)));
    display.br();
    return;
  }

  // ── GET ───────────────────────────────────────────────────────────────────
  if (options.get) {
    if (!hasInit) { display.error('Not initialized. Run: tejas init'); return; }
    const conf = await memory.readConfig();
    const keys = options.get.split('.');
    let val = conf;
    for (const k of keys) val = val?.[k];
    display.info(`${options.get} = ${chalk.cyan(JSON.stringify(val))}`);
    return;
  }

  // ── SET ───────────────────────────────────────────────────────────────────
  if (options.set) {
    if (!hasInit) { display.error('Not initialized. Run: tejas init'); return; }
    const [keyPath, ...valueParts] = options.set.split('=');
    const value = valueParts.join('=');

    if (!keyPath || value === undefined) {
      display.error('Format: --set key=value  or  --set api_keys.claude=sk-xxx');
      return;
    }

    // Build nested object from dot-notation key
    const keys = keyPath.trim().split('.');
    const updates = {};
    let ref = updates;
    keys.forEach((k, i) => {
      if (i === keys.length - 1) {
        ref[k] = value === 'true' ? true : value === 'false' ? false : value;
      } else {
        ref[k] = {};
        ref = ref[k];
      }
    });

    await memory.writeConfig(updates);
    display.success(`Config updated: ${keyPath} = ${value.length > 20 ? value.slice(0,6) + '••••' : value}`);
    return;
  }

  // ── RESET ─────────────────────────────────────────────────────────────────
  if (options.reset) {
    const { confirmed } = await inquirer.prompt([{
      type:    'confirm',
      name:    'confirmed',
      message: chalk.red('Reset all config to defaults? API keys will be lost.'),
      default: false
    }]);
    if (confirmed) {
      const fs = require('fs-extra');
      const path = require('path');
      await fs.remove(path.join(process.cwd(), '.tejas', 'config.json'));
      await memory.initialize();
      display.success('Config reset to defaults.');
    }
  }
};
