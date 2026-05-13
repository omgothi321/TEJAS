'use strict';

const inquirer      = require('inquirer');
const chalk         = require('chalk');
const MemoryManager = require('../core/memory');
const display       = require('../utils/display');

// ─── LEARN COMMAND ────────────────────────────────────────────────────────────
module.exports = async function learn(pattern, options) {
  const memory = new MemoryManager(process.cwd());

  if (!await memory.exists()) {
    display.error('Tejas not initialized. Run: tejas init');
    process.exit(1);
  }

  await memory.initialize();

  // ── SILENT MODE — non-interactive for scripting/Gemini CLI ──────────────
  // Usage: tejas learn "fact" --silent
  // Saves as preference directly without prompts
  if (options.silent || options.s) {
    try {
      const mem = await memory.read();
      if (!mem.user.preferences) mem.user.preferences = {};
      const key = pattern.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30);
      mem.user.preferences[key] = pattern;
      await memory.write({ user: mem.user });
      display.success('Learned: "' + pattern + '"');
    } catch (e) {
      display.error('Learn failed: ' + e.message);
    }
    return;
  }

  display.section('Teaching Tejas');
  display.br();

  const type = options.type || 'workflow';

  let answers;

  switch (type) {
    case 'workflow': {
      answers = await inquirer.prompt([
        {
          type:    'input',
          name:    'name',
          message: 'Workflow name:',
          default: options.name || pattern.slice(0, 30)
        },
        {
          type:    'input',
          name:    'trigger',
          message: 'When should this trigger? (describe in plain English):',
          default: pattern
        },
        {
          type:    'input',
          name:    'description',
          message: 'What does this workflow do?'
        },
        {
          type:    'input',
          name:    'commands',
          message: 'Commands to run (comma-separated, or leave blank):',
        }
      ]);

      const steps = answers.commands
        ? answers.commands.split(',').map((cmd, i) => ({
            step:        i + 1,
            action:      'shell',
            command:     cmd.trim(),
            description: cmd.trim()
          }))
        : [];

      await memory.addWorkflow({
        name:        answers.name,
        trigger:     answers.trigger,
        description: answers.description,
        type:        'workflow',
        steps
      });
      break;
    }

    case 'preference': {
      answers = await inquirer.prompt([
        {
          type:    'input',
          name:    'key',
          message: 'Preference key (e.g., "code_style", "git_branch_prefix"):',
          default: options.name || pattern
        },
        {
          type:    'input',
          name:    'value',
          message: 'Preference value:'
        }
      ]);

      const mem = await memory.read();
      mem.user.preferences[answers.key] = answers.value;
      await memory.write({ user: mem.user });
      display.success(`Preference saved: ${answers.key} = ${answers.value}`);
      return;
    }

    case 'shortcut': {
      answers = await inquirer.prompt([
        {
          type:    'input',
          name:    'alias',
          message: 'Shortcut alias (e.g., "deploy", "test"):',
          default: options.name || pattern
        },
        {
          type:    'input',
          name:    'command',
          message: 'Full command to run:'
        }
      ]);

      const mem = await memory.read();
      mem.user.shortcuts[answers.alias] = answers.command;
      await memory.write({ user: mem.user });
      display.success(`Shortcut saved: tejas run "${answers.alias}" → ${answers.command}`);
      return;
    }

    case 'command': {
      answers = await inquirer.prompt([
        {
          type:    'input',
          name:    'name',
          message: 'Command name:',
          default: options.name || pattern
        },
        {
          type:    'input',
          name:    'command',
          message: 'Shell command:'
        },
        {
          type:    'input',
          name:    'description',
          message: 'Description:'
        }
      ]);

      const mem = await memory.read();
      mem.knowledge.commands.push({
        name:        answers.name,
        command:     answers.command,
        description: answers.description,
        created_at:  new Date().toISOString()
      });
      mem.stats.commands_saved++;
      await memory.write({ knowledge: mem.knowledge, stats: mem.stats });
      break;
    }

    default:
      display.error(`Unknown type: ${type}. Use: workflow|preference|shortcut|command`);
      process.exit(1);
  }

  display.br();
  display.box(
    chalk.white('Pattern: ') + chalk.cyan(answers?.name || answers?.alias || pattern) + '\n' +
    chalk.white('Type:    ') + chalk.cyan(type) + '\n' +
    chalk.white('Saved:   ') + chalk.cyan('.tejas/memory.json'),
    '🧠 Tejas Learned',
    'green'
  );
};
