'use strict';

const chalk           = require('chalk');
const MemoryManager   = require('../core/memory');
const SecurityManager = require('../security/security');
const DashboardServer = require('../core/server');
const display         = require('../utils/display');
const path            = require('path');

// ─── DASHBOARD COMMAND ────────────────────────────────────────────────────────
module.exports = async function dashboard(options) {
  const memory   = new MemoryManager(process.cwd());
  const security = new SecurityManager(path.join(process.cwd(), '.tejas'));

  if (!await memory.exists()) {
    display.error('Tejas not initialized. Run: tejas init');
    process.exit(1);
  }

  // ── Reset token ──────────────────────────────────────────────────────────
  if (options.resetToken) {
    const token = await security.generateToken();
    display.success('New dashboard token generated:');
    console.log('\n  ' + chalk.yellow.bold(token) + '\n');
    display.warn('Save this token — it will not be shown again.');
    return;
  }

  // ── Show token status ────────────────────────────────────────────────────
  if (options.token) {
    const result = await security.getOrCreateToken();
    if (result.exists) {
      display.info(result.message);
    } else {
      display.success('New token created:');
      console.log('\n  ' + chalk.yellow.bold(result.token) + '\n');
      display.warn('Save this — it will not be shown again.');
    }
    return;
  }

  // ── Start dashboard ──────────────────────────────────────────────────────
  const port   = parseInt(options.port) || 4000;
  const server = new DashboardServer({ port, cwd: process.cwd() });

  display.section('Tejas Dashboard');
  display.br();

  console.log(chalk.gray('  Starting secure dashboard server...'));
  display.br();

  try {
    const token = await server.start();

    display.br();
    console.log(chalk.bold.white('  Dashboard URL: ') + chalk.cyan(`http://127.0.0.1:${port}`));

    if (token) {
      console.log(chalk.bold.white('  Token:         ') + chalk.yellow.bold(token));
      display.br();
      display.warn('Save this token — required to access the dashboard.');
      display.warn('It will not be shown again after you close this terminal.');
    }

    display.br();
    console.log(chalk.gray('  Security:'));
    console.log(chalk.gray('  • Localhost only (127.0.0.1) — not exposed to network'));
    console.log(chalk.gray('  • Token auth required for all API calls'));
    console.log(chalk.gray('  • API keys redacted from all outputs'));
    console.log(chalk.gray('  • Rate limited: 30 tasks/minute'));
    console.log(chalk.gray('  • Full audit log at .tejas/audit.log'));
    display.br();
    console.log(chalk.gray('  Press ') + chalk.white('Ctrl+C') + chalk.gray(' to stop the dashboard'));
    display.br();

    // Keep alive
    process.on('SIGINT', () => {
      display.br();
      display.info('Dashboard stopped.');
      server.stop();
      process.exit(0);
    });

    // Prevent exit
    await new Promise(() => {});

  } catch (err) {
    display.error('Failed to start dashboard: ' + err.message);
    if (err.code === 'EADDRINUSE') {
      display.info(`Port ${port} is in use. Try: tejas dashboard --port 4001`);
    }
    process.exit(1);
  }
};
