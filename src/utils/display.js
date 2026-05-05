'use strict';

const chalk   = require('chalk');
const boxen   = require('boxen');
const Table   = require('cli-table3');
const ora     = require('ora');

// ─── DISPLAY ──────────────────────────────────────────────────────────────────
const display = {

  // ── SPINNER ───────────────────────────────────────────────────────────────
  spinner(text) {
    return ora({
      text:    chalk.cyan(text),
      spinner: 'dots2',
      color:   'cyan'
    });
  },

  // ── SUCCESS ───────────────────────────────────────────────────────────────
  success(msg) {
    console.log(chalk.green('  ✓ ') + chalk.white(msg));
  },

  // ── ERROR ─────────────────────────────────────────────────────────────────
  error(msg) {
    console.log(chalk.red('  ✗ ') + chalk.red(msg));
  },

  // ── WARN ──────────────────────────────────────────────────────────────────
  warn(msg) {
    console.log(chalk.yellow('  ⚠ ') + chalk.yellow(msg));
  },

  // ── INFO ──────────────────────────────────────────────────────────────────
  info(msg) {
    console.log(chalk.cyan('  → ') + chalk.white(msg));
  },

  // ── DIM ───────────────────────────────────────────────────────────────────
  dim(msg) {
    console.log(chalk.gray('    ' + msg));
  },

  // ── SECTION HEADER ────────────────────────────────────────────────────────
  section(title) {
    console.log('\n' + chalk.bold.cyan('  ' + title));
    console.log(chalk.gray('  ' + '─'.repeat(title.length + 2)));
  },

  // ── BOX ───────────────────────────────────────────────────────────────────
  box(content, title = null, borderColor = 'cyan') {
    console.log(boxen(content, {
      padding:      1,
      margin:       { top: 1, bottom: 1, left: 2 },
      borderStyle:  'round',
      borderColor,
      title:        title ? chalk.bold(title) : undefined,
      titleAlignment: 'center'
    }));
  },

  // ── TABLE ─────────────────────────────────────────────────────────────────
  table(headers, rows) {
    const t = new Table({
      head:  headers.map(h => chalk.cyan(h)),
      style: { head: [], border: ['gray'] },
      chars: {
        'top': '─', 'top-mid': '┬', 'top-left': '╭', 'top-right': '╮',
        'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '╰', 'bottom-right': '╯',
        'left': '│', 'left-mid': '├', 'mid': '─', 'mid-mid': '┼',
        'right': '│', 'right-mid': '┤', 'middle': '│'
      }
    });
    rows.forEach(row => t.push(row));
    console.log('  ' + t.toString().split('\n').join('\n  '));
  },

  // ── STEP RESULT ───────────────────────────────────────────────────────────
  stepResult(step, result) {
    if (step.action === 'explain') {
      console.log('\n  ' + chalk.cyan.bold('TEJAS:') + ' ' + chalk.white(step.description) + '\n');
      return;
    }

    const icon   = result.success ? chalk.green('✓') : chalk.red('✗');
    const action = chalk.gray(`[${step.action}]`);
    const desc   = chalk.white(step.description || step.command || '');
    const time   = chalk.gray(`${result.duration_ms}ms`);
    console.log(`    ${icon} ${action} ${desc} ${time}`);
    
    if (result.output && String(result.output).trim().length > 0) {
      const lines = String(result.output).trim().split('\n');
      const preview = lines[0];
      const more = lines.length > 1 ? ` (+${lines.length - 1} more lines)` : '';
      console.log(chalk.gray('      ↳ ') + chalk.dim(preview + more));
    }
    
    if (result.error) {
      console.log(chalk.red('      ✗ ') + chalk.red(result.error));
    }
  },

  // ── MEMORY STATS ─────────────────────────────────────────────────────────
  memoryStats(mem) {
    const stats = mem.stats;
    display.section('Memory & Knowledge Graph');
    display.table(
      ['Metric', 'Value'],
      [
        ['Tasks Run',           chalk.yellow(stats.tasks_run)],
        ['Patterns Learned',    chalk.yellow(stats.patterns_learned)],
        ['Workflows Saved',     chalk.yellow(mem.knowledge.workflows.length)],
        ['Total Interactions',  chalk.yellow(stats.total_interactions)],
        ['Time Saved',          chalk.yellow(stats.time_saved_minutes + ' min')],
        ['Last Active',         chalk.gray(mem.agents.last_active || 'Never')]
      ]
    );
  },

  // ── AGENT PLAN ────────────────────────────────────────────────────────────
  agentPlan(plan) {
    display.section(`Agent Plan — ${chalk.yellow(plan.agent)} agent`);
    console.log(chalk.gray('  Understood as: ') + chalk.white(plan.understood_as));
    console.log(chalk.gray('  Steps: ') + chalk.cyan(plan.steps.length));
    console.log(chalk.gray('  Est. time: ') + chalk.cyan(plan.estimated_time_seconds + 's'));
    console.log('');
    plan.steps.forEach(s => {
      const cmd = s.command ? chalk.gray(` → ${s.command}`) : '';
      console.log(chalk.gray(`    ${s.step}.`) + chalk.white(` ${s.description}`) + cmd);
    });
    console.log('');
  },

  // ── NEWLINE ───────────────────────────────────────────────────────────────
  br() {
    console.log('');
  }
};

module.exports = display;
