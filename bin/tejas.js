#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { program } = require('commander');
const chalk       = require('chalk');
const figlet      = require('figlet');
const gradient    = require('gradient-string');

// ─── COMMANDS ─────────────────────────────────────────────────────────────────
const initCommand      = require('../src/commands/init');
const runCommand       = require('../src/commands/run');
const learnCommand     = require('../src/commands/learn');
const statusCommand    = require('../src/commands/status');
const memoryCommand    = require('../src/commands/memory');
const agentCommand     = require('../src/commands/agent');
const configCommand    = require('../src/commands/config');
const graphCommand     = require('../src/commands/graph');
const dashboardCommand = require('../src/commands/dashboard');
const voiceCommand     = require('../src/commands/voice');
const brainCommand     = require('../src/commands/brain');
const updateCommand    = require('../src/commands/update');
const { exec } = require('child_process');

const VERSION = '2.1.0';

// ─── UPDATE CHECK ─────────────────────────────────────────────────────────────
async function checkForUpdates() {
  // Simple check against origin/main without blocking startup
  exec('git fetch origin main && git rev-parse HEAD && git rev-parse origin/main', (err, stdout) => {
    if (err) return;
    const [local, remote] = stdout.trim().split('\n');
    if (local && remote && local !== remote) {
      console.log(chalk.yellow(`\n  [UPDATE] A newer version of Tejas is available.`));
      console.log(chalk.gray(`  Run `) + chalk.cyan('tejas update') + chalk.gray(' to upgrade to the latest God Level features.\n'));
    }
  });
}

// ─── BANNER ───────────────────────────────────────────────────────────────────
function showBanner() {
  const banner = figlet.textSync('TEJAS', { font: 'Block' });
  console.log(gradient.pastel.multiline(banner));
  console.log(chalk.gray('  Tejas — AI + Robotics Operating System  ') + chalk.bold.magenta(`v${VERSION}`));
  console.log();
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
program
  .name('tejas')
  .description('Tejas — AI + Robotics Operating System')
  .version(VERSION)
  .hook('preAction', (thisCommand, actionCommand) => {
    if (!['init', 'config'].includes(actionCommand.name())) {
      showBanner();
      checkForUpdates();
    }
  });

// tejas update
program
  .command('update')
  .description('Update Tejas to the latest version from GitHub')
  .action(updateCommand);

// tejas init
program
  .command('init')
  .description('Initialize Tejas in current project')
  .option('-f, --force', 'Reinitialize existing project')
  .action(initCommand);

// tejas run
program
  .command('run <task>')
  .description('Execute a task using AI agents')
  .option('-a, --agent <agent>',   'Force specific agent: web|file|code|workflow')
  .option('-m, --model <model>',   'Force specific AI model: groq|gemini|xai|deepseek|claude|ollama')
  .option('-v, --verbose',         'Show brain stats and model details')
  .option('--skip-cache',          'Skip workflow cache and always call AI')
  .option('--dry-run',             'Show plan without executing')
  .action(runCommand);

// tejas brain
program
  .command('brain')
  .description('Inspect the Tejas Brain Layer — cache, models, constitution')
  .option('--stats',   'Show brain performance stats (default)')
  .option('--cache',   'List cached workflows')
  .option('--flush',   'Clear workflow cache')
  .option('--models',  'Show model routing stats')
  .option('--test',    'Test all connected AI models')
  .action(brainCommand);

// tejas voice
program
  .command('voice')
  .description('Activate Tejas voice interface')
  .option('-j, --jarvis',          'Continuous wake word mode')
  .option('-l, --listen',          'Listen once and execute')
  .option('-s, --speak <text>',    'Speak a message using TTS')
  .option('-w, --wake-word <word>','Set wake word (default: tejas)')
  .option('--tts <engine>',        'TTS engine: piper|espeak|festival')
  .option('--stt <engine>',        'STT engine: whisper|vosk')
  .action(voiceCommand);

// tejas dashboard
program
  .command('dashboard')
  .description('Launch the Tejas web dashboard')
  .option('-p, --port <port>',   'Port (default: 4000)')
  .option('--token',             'Show or generate access token')
  .option('--reset-token',       'Generate a new access token')
  .action(dashboardCommand);

// tejas status
program
  .command('status')
  .description('Show Tejas system status')
  .action(statusCommand);

// tejas graph
program
  .command('graph')
  .description('Inspect the knowledge graph')
  .option('--stats',           'Show graph statistics')
  .option('--visualize',       'Display node tree')
  .option('--patterns',        'Show detected patterns')
  .option('--recall <query>',  'Query relevant memory')
  .action(graphCommand);

// tejas agent
program
  .command('agent')
  .description('Manage and inspect agents')
  .option('--list',    'List all agents')
  .option('--test',    'Test agent routing')
  .action(agentCommand);

// tejas memory
program
  .command('memory')
  .description('Inspect and manage memory')
  .option('--show',    'Show current memory')
  .option('--clear',   'Clear all memory')
  .option('--search <query>', 'Search memory')
  .action(memoryCommand);

// tejas learn
program
  .command('learn <fact>')
  .description('Teach Tejas a fact or preference')
  .option('-s, --silent', 'Save without interactive prompts (for scripting)')
  .option('-t, --type <type>', 'Type: workflow|preference|command|shortcut')
  .option('-n, --name <name>', 'Name for the workflow or preference')
  .action(learnCommand);

// tejas config
program
  .command('config')
  .description('Manage Tejas configuration')
  .option('--list',           'Show all config values')
  .option('--set <key=value>','Set a config value')
  .option('--get <key>',      'Get a config value')
  .action(configCommand);

program.parse(process.argv);
