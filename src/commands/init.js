'use strict';

const inquirer     = require('inquirer');
const chalk        = require('chalk');
const path         = require('path');
const fs           = require('fs-extra');
const MemoryManager = require('../core/memory');
const Executor      = require('../core/executor');
const display       = require('../utils/display');

// ─── INIT COMMAND ─────────────────────────────────────────────────────────────
module.exports = async function init(options) {
  const memory   = new MemoryManager(process.cwd());
  const executor = new Executor();

  const alreadyInit = await memory.exists();

  if (alreadyInit) {
    display.warn('Tejas is already initialized in this directory.');
    const { reinit } = await inquirer.prompt([{
      type:    'confirm',
      name:    'reinit',
      message: 'Reinitialize? (config will be preserved, memory will reset)',
      default: false
    }]);
    if (!reinit) {
      display.info('No changes made.');
      return;
    }
  }

  display.section('Initializing Tejas');

  // ── Detect environment ──
  const spin = display.spinner('Scanning environment...').start();
  const env  = await executor.detectEnvironment();
  spin.succeed(chalk.green('Environment scanned'));

  display.dim(`OS: ${env.os} | Node: ${env.node} | Tools: ${env.tools.join(', ')}`);
  display.br();

  // ── Gather project info ──
  let projectName  = options.name;
  let projectType  = null;
  let userName     = null;
  let modelChoice  = options.model;
  let apiKey       = null;

  if (!options.silent) {
    const answers = await inquirer.prompt([
      {
        type:    'input',
        name:    'projectName',
        message: 'Project name:',
        default: path.basename(process.cwd()),
        when:    !projectName
      },
      {
        type:    'list',
        name:    'projectType',
        message: 'Project type:',
        choices: [
          { name: '⚡ Node.js / JavaScript',  value: 'nodejs' },
          { name: '🐍 Python',                 value: 'python' },
          { name: '🦫 Go',                     value: 'go' },
          { name: '🦀 Rust',                   value: 'rust' },
          { name: '📱 Mobile (React Native)',  value: 'mobile' },
          { name: '🌐 Web Frontend',           value: 'web' },
          { name: '🤖 AI / ML Project',        value: 'ai' },
          { name: '🔧 DevOps / Infrastructure', value: 'devops' },
          { name: '📦 Other',                  value: 'other' }
        ]
      },
      {
        type:    'input',
        name:    'userName',
        message: 'Your name (for personalization):',
        default: process.env.USER || process.env.USERNAME || 'developer'
      },
      {
        type:    'list',
        name:    'modelChoice',
        message: 'AI model to use:',
        choices: [
          { name: '🧠 Claude (Anthropic) — Best reasoning & code', value: 'claude' },
          { name: '🐋 DeepSeek — Fast, cheap, great at code',      value: 'deepseek' },
          { name: '💬 ChatGPT (OpenAI)',                           value: 'openai' },
          { name: '🌟 Gemini (Google) — You have gemini-cli!',     value: 'gemini' },
          { name: '🦙 Ollama (Local, private)',                    value: 'ollama' }
        ],
        when: !options.model
      },
      {
        type:     'password',
        name:     'apiKey',
        message:  (ans) => `${(ans.modelChoice || options.model).toUpperCase()} API key (leave blank to set later):`,
        when:     (ans) => (ans.modelChoice || options.model) !== 'ollama',
        mask:     '*'
      }
    ]);

    projectName  = answers.projectName  || projectName;
    projectType  = answers.projectType;
    userName     = answers.userName;
    modelChoice  = answers.modelChoice  || modelChoice;
    apiKey       = answers.apiKey;
  }

  // ── Initialize memory + config ──
  const spin2 = display.spinner('Creating Tejas memory graph...').start();

  await memory.initialize({
    name:  projectName,
    type:  projectType
  });

  // Update user info
  await memory.write({
    user: {
      name: userName,
      preferences: { theme: 'dark' },
      work_patterns: [],
      shortcuts: {}
    },
    world_model: {
      os:    env.os,
      tools: env.tools
    }
  });

  // Update config with model + API key
  const configUpdates = { model: modelChoice };
  if (apiKey) {
    const keyMap = {
      claude:   'api_keys.claude',
      deepseek: 'api_keys.deepseek',
      openai:   'api_keys.openai'
    };
    if (keyMap[modelChoice]) {
      configUpdates.api_keys = {};
      configUpdates.api_keys[modelChoice] = apiKey;
    }
  }
  await memory.writeConfig(configUpdates);

  spin2.succeed(chalk.green('Memory graph initialized'));

  // ── Create .gitignore entry ──
  try {
    const gitignore = path.join(process.cwd(), '.gitignore');
    if (await fs.pathExists(gitignore)) {
      const content = await fs.readFile(gitignore, 'utf8');
      if (!content.includes('.tejas/logs')) {
        await fs.appendFile(gitignore, '\n# Tejas\n.tejas/logs/\n.tejas/config.json\n');
        display.dim('Updated .gitignore');
      }
    }
  } catch (err) {
    display.dim('Could not update .gitignore: ' + err.message);
  }

  // ── Done ──
  display.br();
  display.box(
    chalk.white(`Project: `) + chalk.cyan(projectName) + '\n' +
    chalk.white(`Model:   `) + chalk.cyan(modelChoice) + '\n' +
    chalk.white(`Memory:  `) + chalk.cyan('.tejas/memory.json') + '\n' +
    chalk.white(`OS:      `) + chalk.cyan(env.os) + '\n' +
    chalk.white(`Tools:   `) + chalk.cyan(env.tools.join(', ')),
    '⚡ Tejas Initialized',
    'green'
  );

  console.log(chalk.gray('  Next steps:'));
  console.log(chalk.gray('  ') + chalk.cyan('tejas run "set up my project"') + chalk.gray('   — run your first task'));
  console.log(chalk.gray('  ') + chalk.cyan('tejas learn "my workflow"') + chalk.gray('       — teach Tejas a pattern'));
  console.log(chalk.gray('  ') + chalk.cyan('tejas status') + chalk.gray('                   — view system status'));
  console.log(chalk.gray('  ') + chalk.cyan('tejas config --list') + chalk.gray('             — view/change settings'));
  display.br();
};
